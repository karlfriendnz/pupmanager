import { prisma } from '@/lib/prisma'
import { startOfDayInTz, endOfDayInTz } from '@/lib/timezone'

export type DayStop = {
  id: string
  name: string
  address: string | null
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
  // Total minutes of visits at this stop that day (sum of the day's sessions),
  // for ETA chaining in the run-sheet.
  visitMins: number
}

// Distinct clients who have a visit on `date` (in the trainer's tz), optionally
// filtered to one trainer member (assigned trainer) — multi-trainer businesses
// route each member's day separately. memberId 'all'/undefined = whole business.
export async function getDayStops(
  companyId: string,
  date: string,
  tz: string,
  memberId?: string | null,
): Promise<DayStop[]> {
  const start = startOfDayInTz(date, tz)
  const end = endOfDayInTz(date, tz)
  const sessions = await prisma.trainingSession.findMany({
    where: {
      trainerId: companyId,
      scheduledAt: { gte: start, lte: end },
      clientId: { not: null },
      ...(memberId && memberId !== 'all' ? { assignedMembershipId: memberId } : {}),
    },
    select: {
      scheduledAt: true,
      durationMins: true,
      dog: { select: { name: true } },
      client: {
        select: {
          id: true, addressLine: true, addressLat: true, addressLng: true,
          user: { select: { name: true, email: true } },
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

  // One stop per client (household). Sessions are earliest-first, so the first
  // time we see a client is their earliest visit; we collect every dog visited
  // there that day (a household can have multiple dogs).
  const seen = new Map<string, DayStop & { _dogs: Set<string>; _endAt: Date }>()
  for (const s of sessions) {
    const c = s.client
    if (!c) continue
    const endAt = new Date(s.scheduledAt.getTime() + (s.durationMins ?? 0) * 60_000)
    let entry = seen.get(c.id)
    if (!entry) {
      entry = {
        id: c.id,
        name: c.user.name ?? c.user.email,
        address: c.addressLine,
        lat: c.addressLat,
        lng: c.addressLng,
        time: fmtTime(s.scheduledAt),
        endTime: fmtTime(endAt),
        timeMins: minsOf(s.scheduledAt),
        dogs: [],
        visitMins: 0,
        _dogs: new Set<string>(),
        _endAt: endAt,
      }
      seen.set(c.id, entry)
    }
    if (s.dog?.name) entry._dogs.add(s.dog.name)
    entry.visitMins += s.durationMins ?? 0
    if (endAt > entry._endAt) { entry._endAt = endAt; entry.endTime = fmtTime(endAt) }
  }
  return [...seen.values()].map(({ _dogs, _endAt, ...e }) => ({ ...e, dogs: [..._dogs] }))
}
