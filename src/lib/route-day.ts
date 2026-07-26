import { prisma } from '@/lib/prisma'
import { startOfDayInTz, endOfDayInTz } from '@/lib/timezone'
import { runKindLabel, runHref } from '@/lib/run-kind'

// Everything a trainer drives to in a day.
//
// EVERY kind of booking is a TrainingSession row — 1:1 consults carry a
// clientId, and group classes, casual/drop-in classes, one-off events and
// doggy daycare all carry a classRunId with clientId null (attendance is
// per-enrollee). This used to select `clientId: { not: null }`, so the route
// planner silently planned around the 1:1 sessions ONLY: a trainer whose
// Tuesday was a puppy class, a daycare day and one home visit got a route with
// a single stop on it. All of them are stops now.
//
// The two kinds locate themselves differently, which is the whole reason this
// file has to know about both:
//
//   • a CLIENT stop is at the client's own address, which is geocoded
//     (addressLat/addressLng) — it can go straight on the map.
//   • a GROUP stop is at the venue, which is free text by design
//     (ClassRun.location: "the field behind the hall" is a valid answer) and
//     has no coordinates anywhere in the schema. It routes as an ADDRESS
//     waypoint instead — Google resolves it — so it has no lat/lng until the
//     route has been optimised.
//
// A stop that can't be driven to is NOT silently dropped, because a missing
// stop is indistinguishable from a day with nothing on it. It comes back with
// `blocked` set and the UI lists it separately with the reason.

export type StopKind = 'client' | 'group'

/** Why a stop can't be put on the route. Null = routable. */
export type StopBlocker =
  // Online session — there's nowhere to drive to.
  | 'virtual'
  // A group run with no venue written down (a known gap — a class can be
  // created without one). The trainer is linked to the run to fill it in.
  | 'no-location'
  // A client with no address on file.
  | 'no-address'

export type DayStop = {
  /** Stable key for this stop — "client:<id>" or "run:<runId>:<venue>". */
  id: string
  kind: StopKind
  /** Set on client stops; the UI links to the client profile. */
  clientId: string | null
  /** Set on group stops; the UI links to the class / event / daycare run. */
  classRunId: string | null
  /** Client name, or the name of the class / event. */
  name: string
  /** What this is, in a word: "1:1", "Class", "Casual class", "Event", "Daycare". */
  kindLabel: string
  /** Where to send the trainer to fix or read this stop. */
  href: string
  address: string | null
  /** Null on every group stop — venues are free text, see above. */
  lat: number | null
  lng: number | null
  // Visit window that day, formatted in the trainer's tz: earliest session
  // start ("9:20am") and latest session end ("10:05am").
  time: string | null
  endTime: string | null
  // Earliest start as minutes-since-midnight (tz-local), for sorting/compare.
  timeMins: number | null
  // Dog(s) visited at this client that day — a household can have several.
  dogs: string[]
  /** Group stops: how many places are booked that day. 0 on client stops. */
  attendees: number
  // Total minutes of visits at this stop that day (sum of the day's sessions),
  // for ETA chaining in the run-sheet.
  visitMins: number
  /** Null when the stop can be driven to. */
  blocked: StopBlocker | null
}

// A ClassRun is the one model behind four sections of the app, and each has
// its own detail route. `runKindLabel` / `runHref` used to be private copies
// here; they now come from lib/run-kind so the schedule grid, /sessions/[id]
// and the route planner can't drift apart about which section a run belongs to.

// Every stop on `date` (in the trainer's tz), optionally filtered to one
// trainer member — multi-trainer businesses route each member's day
// separately. memberId 'all'/undefined = whole business.
export async function getDayStops(
  companyId: string,
  date: string,
  tz: string,
  memberId?: string | null,
): Promise<DayStop[]> {
  const start = startOfDayInTz(date, tz)
  const end = endOfDayInTz(date, tz)
  const scoped = memberId && memberId !== 'all' ? memberId : null

  const sessions = await prisma.trainingSession.findMany({
    where: {
      trainerId: companyId,
      scheduledAt: { gte: start, lte: end },
      // Both conditions are their own OR, so they live under AND — two `OR`
      // keys in one object would just overwrite each other.
      AND: [
        // 1:1 sessions and group sessions both. The only rows skipped are the
        // ones orphaned by client deletion — clientId is SetNull when a client
        // is removed, leaving a row with nobody to attribute it to and no run
        // either. Same predicate the schedule itself uses.
        { OR: [{ clientId: { not: null } }, { classRunId: { not: null } }] },
        // A group session can be staffed either on the session itself or on
        // the run (ClassRunTrainer). Filtering on the session alone hid a
        // member's whole class from their own route.
        ...(scoped
          ? [{
              OR: [
                { assignedMembershipId: scoped },
                { classRun: { assignedTrainers: { some: { membershipId: scoped } } } },
              ],
            }]
          : []),
      ],
    },
    select: {
      id: true,
      scheduledAt: true,
      durationMins: true,
      sessionType: true,
      location: true,
      classRunId: true,
      dog: { select: { name: true } },
      client: {
        select: {
          id: true, addressLine: true, addressLat: true, addressLng: true,
          user: { select: { name: true, email: true } },
        },
      },
      classRun: {
        select: {
          id: true,
          name: true,
          location: true,
          package: {
            select: {
              isGroup: true, allowDropIn: true, sessionCount: true,
              recurrenceRule: true, isPuppySchool: true,
            },
          },
          _count: { select: { enrollments: true } },
        },
      },
    },
    orderBy: { scheduledAt: 'asc' },
  })

  const fmtTime = (d: Date) =>
    new Intl.DateTimeFormat('en-NZ', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
      .format(d)
      .replace(' ', '')
      .toLowerCase()
  const minsOf = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-NZ', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
    const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
    const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
    return (h % 24) * 60 + m
  }

  // Sessions are earliest-first, so the first time a stop is seen is its
  // earliest visit. Merging matters most for daycare, where the day-parts of
  // one run are separate sessions at the same venue — that's ONE arrival, not
  // three — and for a household with two dogs booked back to back.
  type Acc = DayStop & { _dogs: Set<string>; _endAt: Date }
  const seen = new Map<string, Acc>()

  const upsert = (key: string, make: () => Acc) => {
    let entry = seen.get(key)
    if (!entry) { entry = make(); seen.set(key, entry) }
    return entry
  }

  for (const s of sessions) {
    const endAt = new Date(s.scheduledAt.getTime() + (s.durationMins ?? 0) * 60_000)
    const virtual = s.sessionType === 'VIRTUAL'

    if (s.classRun) {
      const run = s.classRun
      // A per-session override beats the run's default venue: a class can meet
      // somewhere else for one week.
      const venue = (s.location ?? run.location)?.trim() || null
      // Two slots of the same run at different venues on one day are two
      // arrivals, so the venue is part of the key.
      const key = `run:${run.id}:${venue ?? ''}`
      const entry = upsert(key, () => ({
        id: key,
        kind: 'group' as const,
        clientId: null,
        classRunId: run.id,
        name: run.name,
        kindLabel: runKindLabel(run.package),
        href: runHref(run.id, run.package),
        address: venue,
        // Free text — resolved by the Routes API at optimise time, not here.
        lat: null,
        lng: null,
        time: fmtTime(s.scheduledAt),
        endTime: fmtTime(endAt),
        timeMins: minsOf(s.scheduledAt),
        dogs: [],
        attendees: run._count.enrollments,
        visitMins: 0,
        blocked: virtual ? 'virtual' : venue ? null : 'no-location',
        _dogs: new Set<string>(),
        _endAt: endAt,
      }))
      entry.visitMins += s.durationMins ?? 0
      // An in-person session at a venue un-blocks a stop an earlier virtual
      // session had marked online — the trainer does have to be there.
      if (!virtual && entry.blocked === 'virtual') entry.blocked = venue ? null : 'no-location'
      if (endAt > entry._endAt) { entry._endAt = endAt; entry.endTime = fmtTime(endAt) }
      continue
    }

    const c = s.client
    if (!c) continue
    const key = `client:${c.id}`
    const entry = upsert(key, () => ({
      id: key,
      kind: 'client' as const,
      clientId: c.id,
      classRunId: null,
      name: c.user.name ?? c.user.email,
      kindLabel: '1:1',
      href: `/clients/${c.id}/edit?tab=details`,
      address: c.addressLine,
      lat: c.addressLat,
      lng: c.addressLng,
      time: fmtTime(s.scheduledAt),
      endTime: fmtTime(endAt),
      timeMins: minsOf(s.scheduledAt),
      dogs: [],
      attendees: 0,
      visitMins: 0,
      // A VIRTUAL 1:1 used to be routed to the client's house, adding a drive
      // to a session nobody travels for.
      blocked: virtual ? 'virtual' : c.addressLat != null && c.addressLng != null ? null : 'no-address',
      _dogs: new Set<string>(),
      _endAt: endAt,
    }))
    if (s.dog?.name) entry._dogs.add(s.dog.name)
    entry.visitMins += s.durationMins ?? 0
    if (!virtual && entry.blocked === 'virtual') {
      entry.blocked = c.addressLat != null && c.addressLng != null ? null : 'no-address'
    }
    if (endAt > entry._endAt) { entry._endAt = endAt; entry.endTime = fmtTime(endAt) }
  }

  return [...seen.values()]
    .map(({ _dogs, _endAt, ...e }) => ({ ...e, dogs: [..._dogs] }))
    .sort((a, b) => (a.timeMins ?? 0) - (b.timeMins ?? 0))
}
