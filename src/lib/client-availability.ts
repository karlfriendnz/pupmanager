// Shared fetch of a client's trainer availability (slots + blackouts + tz).
// One source of truth for the my-availability page, the self-book availability
// API, and the server-side self-book guard, so the query + row mapping never
// drift apart.
import { prisma } from './prisma'
import type { AvailabilityRow, BlackoutRow, BusyInterval } from './availability'
import { utcToZonedDateAndMinutes, todayInTz } from './timezone'

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

  const tz = profile.trainer.user.timezone
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
      where: { trainerId: profile.trainerId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    }),
    prisma.blackoutPeriod.findMany({
      where: { trainerId: profile.trainerId, endDate: { gte: cutoff } },
    }),
    prisma.trainingSession.findMany({
      where: {
        trainerId: profile.trainerId,
        scheduledAt: { gte: fetchStart, lte: fetchEnd },
        status: 'UPCOMING',
      },
      select: { scheduledAt: true, durationMins: true },
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

  // Each UPCOMING session → a trainer-local minute range on the day it starts.
  // (Google Calendar busy blocks are intentionally excluded: trainer-side treats
  // them as a soft, never-blocking warning, and the client availability page
  // only ever subtracts real sessions — keep the two in lockstep.)
  const busy: BusyInterval[] = rawSessions.map(s => {
    const { dateStr, minuteOfDay } = utcToZonedDateAndMinutes(s.scheduledAt, tz)
    return { dateStr, startMin: minuteOfDay, endMin: minuteOfDay + s.durationMins }
  })

  return {
    trainerId: profile.trainerId,
    businessName: profile.trainer.businessName,
    tz,
    slots,
    blackouts,
    busy,
  }
}
