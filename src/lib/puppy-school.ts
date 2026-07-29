// Data for the Puppy School workspace: the list of a trainer's schools and the
// live week board (day-parts down the side, days across the top). A puppy school
// is a Package with isPuppySchool, materialised as ClassRun(s) whose sessions
// come from the day-part slots. The board groups this week's sessions by
// weekday × start-time and shows occupancy + waitlist per cell.
import { prisma } from './prisma'
import { openDaysFromSlots } from './daycare-days'

const DAY_MS = 86_400_000
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const pad = (n: number) => String(n).padStart(2, '0')

function parts(tz: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-NZ', { timeZone: tz, ...opts })
}
function tzDateKey(d: Date, tz: string): string {
  const p = parts(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const g = (t: string) => p.find(x => x.type === t)!.value
  return `${g('year')}-${g('month')}-${g('day')}`
}
function tzTimeKey(d: Date, tz: string): string {
  const p = parts(tz, { hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const g = (t: string) => p.find(x => x.type === t)!.value
  return `${g('hour')}:${g('minute')}`
}
function tzTimeLabel(d: Date, tz: string): string {
  return parts(tz, { hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
}
/** "07:00" → "7:00 AM". A slot's times are wall-clock, so no timezone involved. */
function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`
}

export interface PuppySchoolSummary {
  id: string
  name: string
  dayParts: number // distinct start–end pairs across the week's slots
  days: number // distinct weekdays it runs
  runId: string | null
}

export async function listPuppySchools(trainerId: string): Promise<PuppySchoolSummary[]> {
  const pkgs = await prisma.package.findMany({
    where: { trainerId, isPuppySchool: true },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      sessionSlots: { select: { day: true, startTime: true, endTime: true } },
      classRuns: { select: { id: true }, orderBy: { startDate: 'asc' }, take: 1 },
    },
  })
  return pkgs.map(p => ({
    id: p.id,
    name: p.name,
    // Start AND end — a full day and a half day opening at the same minute are
    // two day-parts, not one. Must match the week board's row key.
    dayParts: new Set(p.sessionSlots.map(s => `${s.startTime}-${s.endTime}`)).size,
    days: new Set(p.sessionSlots.map(s => s.day)).size,
    runId: p.classRuns[0]?.id ?? null,
  }))
}

export interface BoardAttendee { dogId: string; dog: string; owner: string; clientId: string; photoUrl: string | null; phone: string | null }
export interface WeekBoardCell {
  booked: number
  capacity: number | null
  waitlist: number
  attendees: BoardAttendee[]
  /** Where tapping the cell goes: the day-part's own session screen. */
  runId: string | null
  sessionId: string
  /**
   * The day-part this cell is an occurrence of. The limit lives here, not on the
   * session — one slot is one weekday's part, so changing it changes that day
   * every week. Null for a session generated without a slot behind it.
   */
  slotId: string | null
  /**
   * This part has been and gone, so nothing new can be booked into it. Mirrors
   * the rule enrollInRun enforces (not UPCOMING, or already started) so the
   * board doesn't offer a tap that the server is certain to refuse.
   */
  closed: boolean
}
export interface WeekBoard {
  tz: string
  /** Every day of the Mon–Sun week. The board shows the ones in `openDays`. */
  columns: { key: string; label: string }[]
  /** ISO weekdays (1=Mon…7=Sun) the daycare's own day-parts run on. */
  openDays: number[]
  parts: { key: string; label: string }[]
  cells: Record<string, Record<string, WeekBoardCell>>
  totalBooked: number
  /** Column key for today (if it falls in this week), for highlighting. */
  todayKey: string
}

/**
 * The current Mon–Sun week board across all of a trainer's puppy-school runs.
 * Week columns are computed as calendar dates in the trainer's timezone (no
 * instant math); sessions are bucketed by their zoned date + start time.
 */
export async function getPuppySchoolWeek(trainerId: string, now: Date = new Date()): Promise<WeekBoard> {
  const [profile, openSlots] = await Promise.all([
    prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { user: { select: { timezone: true } } },
    }),
    // The daycare's own day-parts say which days it runs — see openDaysFromSlots.
    prisma.packageSessionSlot.findMany({
      where: { package: { trainerId, isPuppySchool: true } },
      select: { day: true },
    }),
  ])
  const tz = profile?.user.timezone ?? 'Pacific/Auckland'
  const openDays = openDaysFromSlots(openSlots)

  // Monday of the current week, as a pure calendar date in tz.
  const np = parts(tz, { weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const g = (t: string) => np.find(x => x.type === t)!.value
  const sun0 = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[g('weekday')] ?? 1
  const mon0 = (sun0 + 6) % 7
  const mondayCal = Date.UTC(Number(g('year')), Number(g('month')) - 1, Number(g('day'))) - mon0 * DAY_MS
  const columns = Array.from({ length: 7 }, (_, i) => {
    const c = new Date(mondayCal + i * DAY_MS)
    return { key: `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())}`, label: `${DOW[i]} ${c.getUTCDate()}` }
  })
  const colByKey = new Map(columns.map(c => [c.key, c.key]))
  const todayKey = tzDateKey(now, tz)

  // Sessions across the window (generous bounds; filtered to the 7 columns by key).
  const sessions = await prisma.trainingSession.findMany({
    where: {
      scheduledAt: { gte: new Date(mondayCal - 2 * DAY_MS), lt: new Date(mondayCal + 9 * DAY_MS) },
      classRun: { trainerId, package: { isPuppySchool: true } },
    },
    select: {
      id: true, scheduledAt: true, status: true, classRunId: true,
      packageSessionSlot: { select: { id: true, capacity: true, startTime: true, endTime: true } },
      classRun: { select: { capacity: true, package: { select: { capacity: true } } } },
    },
  })
  if (sessions.length === 0) return { tz, columns, openDays, parts: [], cells: {}, totalBooked: 0, todayKey }

  const runIds = [...new Set(sessions.map(s => s.classRunId).filter((x): x is string => !!x))]
  const enrollments = await prisma.classEnrollment.findMany({
    where: { classRunId: { in: runIds }, status: { in: ['ENROLLED', 'WAITLISTED'] } },
    select: {
      classRunId: true, status: true, type: true, dropInSessionId: true,
      dog: { select: { id: true, name: true, photoUrl: true } },
      client: { select: { id: true, phone: true, user: { select: { name: true } } } },
    },
  })

  // FULL enrolments attend every session of their run; drop-ins only their one.
  const fullEnrolled = new Map<string, number>(), fullWait = new Map<string, number>()
  const dropEnrolled = new Map<string, number>(), dropWait = new Map<string, number>()
  // Who's coming: FULL enrolees by run, drop-ins by their session.
  const fullAttendees = new Map<string, BoardAttendee[]>()
  const dropAttendees = new Map<string, BoardAttendee[]>()
  const bump = (m: Map<string, number>, k: string | null) => { if (k) m.set(k, (m.get(k) ?? 0) + 1) }
  const addAtt = (m: Map<string, BoardAttendee[]>, k: string | null, e: (typeof enrollments)[number]) => {
    if (!k) return
    const list = m.get(k) ?? []
    list.push({ dogId: e.dog?.id ?? '', dog: e.dog?.name ?? 'Dog', owner: e.client?.user?.name ?? '', clientId: e.client?.id ?? '', photoUrl: e.dog?.photoUrl ?? null, phone: e.client?.phone ?? null })
    m.set(k, list)
  }
  for (const e of enrollments) {
    const enrolled = e.status === 'ENROLLED'
    if (e.type === 'FULL') { bump(enrolled ? fullEnrolled : fullWait, e.classRunId); if (enrolled) addAtt(fullAttendees, e.classRunId, e) }
    else { bump(enrolled ? dropEnrolled : dropWait, e.dropInSessionId); if (enrolled) addAtt(dropAttendees, e.dropInSessionId, e) }
  }

  const partLabels = new Map<string, string>()
  const cells: Record<string, Record<string, WeekBoardCell>> = {}
  let totalBooked = 0
  for (const s of sessions) {
    const colKey = colByKey.get(tzDateKey(s.scheduledAt, tz))
    if (!colKey) continue
    // A row is a DAY-PART, which is a start AND an end — not a start alone. A
    // daycare routinely runs a full day and a half day that open at the same
    // minute (7am–6pm and 7am–12pm); keying on the start collapsed them into one
    // row, and the second session then overwrote the first along with its
    // bookings. Falls back to the start time for a session with no slot.
    const slot = s.packageSessionSlot
    // Both times are needed to name a day-part; without them fall back to the
    // session's own start rather than inventing an "undefined" row.
    const ranged = slot?.startTime && slot?.endTime ? slot : null
    const partKey = ranged ? `${ranged.startTime}-${ranged.endTime}` : tzTimeKey(s.scheduledAt, tz)
    if (!partLabels.has(partKey)) {
      partLabels.set(
        partKey,
        ranged
          ? `${clockLabel(ranged.startTime)} – ${clockLabel(ranged.endTime)}`
          : tzTimeLabel(s.scheduledAt, tz),
      )
    }
    const capacity = s.packageSessionSlot?.capacity ?? s.classRun?.capacity ?? s.classRun?.package.capacity ?? null
    const booked = (s.classRunId ? fullEnrolled.get(s.classRunId) ?? 0 : 0) + (dropEnrolled.get(s.id) ?? 0)
    const waitlist = (s.classRunId ? fullWait.get(s.classRunId) ?? 0 : 0) + (dropWait.get(s.id) ?? 0)
    const attendees = [
      ...(s.classRunId ? fullAttendees.get(s.classRunId) ?? [] : []),
      ...(dropAttendees.get(s.id) ?? []),
    ]
    totalBooked += booked
    // Accumulate rather than assign: two sessions can still share a cell (the
    // same day-part running twice in a day), and the later one must not erase
    // the earlier one's bookings.
    const cell = (cells[partKey] ??= {})[colKey]
    if (cell) {
      cell.booked += booked
      cell.waitlist += waitlist
      cell.attendees.push(...attendees)
      // A null capacity means "unlimited" — it must stay null, not become a sum.
      cell.capacity = cell.capacity === null || capacity === null ? null : cell.capacity + capacity
      // runId/sessionId/slotId stay the FIRST session's: when two sessions share
      // a cell the tap has to land somewhere, and the earlier one is the one a
      // trainer means by "the 9am".
    } else {
      cells[partKey][colKey] = {
        booked, capacity, waitlist, attendees,
        runId: s.classRunId, sessionId: s.id, slotId: s.packageSessionSlot?.id ?? null,
        closed: s.status !== 'UPCOMING' || s.scheduledAt.getTime() <= now.getTime(),
      }
    }
  }

  const partsArr = [...partLabels.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, label]) => ({ key, label }))
  return { tz, columns, openDays, parts: partsArr, cells, totalBooked, todayKey }
}
