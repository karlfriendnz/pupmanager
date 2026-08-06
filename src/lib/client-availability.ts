// Shared fetch of a client's trainer availability (slots + blackouts + tz).
// One source of truth for the my-availability page, the self-book availability
// API, and the server-side self-book guard, so the query + row mapping never
// drift apart.
import { prisma } from './prisma'
import type { AvailabilityRow, BlackoutRow, BusyInterval } from './availability'
import { utcToZonedDateAndMinutes, todayInTz } from './timezone'
import { liveHolds } from './booking-holds'

// How far ahead we consider bookings — matches the my-availability page window.
const DAYS_AHEAD = 28

export interface TrainerAvailability {
  trainerId: string
  businessName: string
  tz: string
  slots: AvailabilityRow[]
  blackouts: BlackoutRow[]
  // Trainer's existing UPCOMING sessions over the window, as trainer-local
  // minute ranges — the times a self-book must NOT overlap.
  busy: BusyInterval[]
}

/**
 * Resolves the active client's trainer and returns their published
 * availability. `null` if the client profile is missing. Blackouts are
 * trimmed to those still relevant (ending on/after ~yesterday) to bound the
 * result; date filtering for a given day is handled by isBlackoutDate.
 */
export async function getTrainerAvailabilityForClient(clientId: string): Promise<TrainerAvailability | null> {
  const profile = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: {
      trainerId: true,
      trainer: {
        select: {
          businessName: true,
          user: { select: { timezone: true } },
        },
      },
    },
  })
  if (!profile) return null
  // Their own booking holds are excluded: a client half-way through booking 2pm
  // must still be shown 2pm, and must not be refused their own slot when the
  // confirm re-validates it. Everybody ELSE'S live hold does block them.
  return loadAvailability(profile.trainerId, profile.trainer.user.timezone, profile.trainer.businessName, clientId)
}

/**
 * The same availability, addressed by trainer rather than by client — for
 * TRAINER-side screens that need to know what their own openings look like.
 *
 * Used by the booking-window preview, so the "this window offers no times"
 * warning is computed against real availability, real blackouts and what is
 * really in the diary, rather than against the window in the abstract.
 */
export async function getTrainerAvailabilityById(trainerId: string): Promise<TrainerAvailability | null> {
  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { businessName: true, user: { select: { timezone: true } } },
  })
  if (!trainer) return null
  return loadAvailability(trainerId, trainer.user.timezone, trainer.businessName)
}

/** The shared query + row mapping. One copy, so the two entry points above can
 *  never answer the same question differently. */
async function loadAvailability(
  trainerId: string,
  tz: string,
  businessName: string,
  // Whose own booking holds don't count against them. Null on the trainer-side
  // entry point: a trainer looking at their own openings wants to see every
  // claim on the diary, including the ones clients are mid-way through making.
  excludeClientId: string | null = null,
): Promise<TrainerAvailability> {
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - 1)

  // Session window: [today, today+DAYS_AHEAD] in the trainer's tz, padded a day
  // each side in UTC so tz offset never drops a session touching the edges.
  const today = todayInTz(tz)
  const [ty, tm, td] = today.split('-').map(Number)
  const fetchStart = new Date(Date.UTC(ty, tm - 1, td - 1))
  const fetchEnd = new Date(Date.UTC(ty, tm - 1, td + DAYS_AHEAD + 1))

  const [rawSlots, rawBlackouts, rawSessions] = await Promise.all([
    prisma.availabilitySlot.findMany({
      where: { trainerId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    }),
    prisma.blackoutPeriod.findMany({
      where: { trainerId, endDate: { gte: cutoff } },
    }),
    prisma.trainingSession.findMany({
      where: {
        trainerId,
        scheduledAt: { gte: fetchStart, lte: fetchEnd },
        status: 'UPCOMING',
      },
      select: { scheduledAt: true, durationMins: true, bufferMins: true },
    }),
  ])

  const slots: AvailabilityRow[] = rawSlots.map(s => ({
    id: s.id,
    dayOfWeek: s.dayOfWeek,
    date: s.date ? s.date.toISOString().split('T')[0] : null,
    startTime: s.startTime,
    endTime: s.endTime,
    cadenceWeeks: s.cadenceWeeks,
    firstDate: s.firstDate ? s.firstDate.toISOString().split('T')[0] : null,
  }))

  const blackouts: BlackoutRow[] = rawBlackouts.map(b => ({
    startDate: b.startDate.toISOString().split('T')[0],
    endDate: b.endDate.toISOString().split('T')[0],
  }))

  // Each UPCOMING session → a trainer-local minute range on the day it starts,
  // carrying the turnaround buffer it was booked with so the client's picker
  // can't offer a slot inside another session's clean-up/travel gap.
  // (Google Calendar busy blocks are intentionally excluded: trainer-side treats
  // them as a soft, never-blocking warning, and the client availability page
  // only ever subtracts real sessions — keep the two in lockstep.)
  const busy: BusyInterval[] = rawSessions.map(s => {
    const { dateStr, minuteOfDay } = utcToZonedDateAndMinutes(s.scheduledAt, tz)
    return {
      dateStr,
      startMin: minuteOfDay,
      endMin: minuteOfDay + s.durationMins,
      bufferMins: s.bufferMins,
    }
  })

  // Slots somebody else is part-way through booking. A BookingHold is not a
  // session — nothing that draws a calendar or counts a booking reads that
  // table — but it does occupy the hour while a client answers the offering's
  // gating form, or their card clears. Expiry is applied by the QUERY
  // (expiresAt > now), so a hold that lapsed a moment ago is already gone from
  // this list whether or not the sweep has run; the cron only tidies rows away.
  //
  // Their OWN hold is excluded, or the client holding 2pm would be shown a
  // picker with 2pm missing and refused their own slot on confirm.
  const holds = await liveHolds(trainerId, fetchStart, fetchEnd, { excludeClientId, now: new Date() })
  for (const h of holds) {
    const { dateStr, minuteOfDay } = utcToZonedDateAndMinutes(h.slotAt, tz)
    busy.push({
      dateStr,
      startMin: minuteOfDay,
      endMin: minuteOfDay + h.durationMins,
      bufferMins: h.bufferMins,
    })
  }

  return {
    trainerId,
    businessName,
    tz,
    slots,
    blackouts,
    busy,
  }
}
