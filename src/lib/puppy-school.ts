// Data for the Puppy School workspace: the list of a trainer's schools and the
// live week board (day-parts down the side, days across the top). A puppy school
// is a Package with isPuppySchool, materialised as ClassRun(s) whose sessions
// come from the day-part slots. The board groups this week's sessions by
// weekday × start-time and shows occupancy + waitlist per cell.
import { prisma } from './prisma'

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

export interface PuppySchoolSummary {
  id: string
  name: string
  dayParts: number // distinct start-times across the week's slots
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
      sessionSlots: { select: { day: true, startTime: true } },
      classRuns: { select: { id: true }, orderBy: { startDate: 'asc' }, take: 1 },
    },
  })
  return pkgs.map(p => ({
    id: p.id,
    name: p.name,
    dayParts: new Set(p.sessionSlots.map(s => s.startTime)).size,
    days: new Set(p.sessionSlots.map(s => s.day)).size,
    runId: p.classRuns[0]?.id ?? null,
  }))
}

export interface WeekBoardCell { booked: number; capacity: number | null; waitlist: number }
export interface WeekBoard {
  tz: string
  columns: { key: string; label: string }[]
  parts: { key: string; label: string }[]
  cells: Record<string, Record<string, WeekBoardCell>>
  totalBooked: number
}

/**
 * The current Mon–Sun week board across all of a trainer's puppy-school runs.
 * Week columns are computed as calendar dates in the trainer's timezone (no
 * instant math); sessions are bucketed by their zoned date + start time.
 */
export async function getPuppySchoolWeek(trainerId: string, now: Date = new Date()): Promise<WeekBoard> {
  const profile = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { user: { select: { timezone: true } } },
  })
  const tz = profile?.user.timezone ?? 'Pacific/Auckland'

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

  // Sessions across the window (generous bounds; filtered to the 7 columns by key).
  const sessions = await prisma.trainingSession.findMany({
    where: {
      scheduledAt: { gte: new Date(mondayCal - 2 * DAY_MS), lt: new Date(mondayCal + 9 * DAY_MS) },
      classRun: { trainerId, package: { isPuppySchool: true } },
    },
    select: {
      id: true, scheduledAt: true, classRunId: true,
      packageSessionSlot: { select: { capacity: true } },
      classRun: { select: { capacity: true, package: { select: { capacity: true } } } },
    },
  })
  if (sessions.length === 0) return { tz, columns, parts: [], cells: {}, totalBooked: 0 }

  const runIds = [...new Set(sessions.map(s => s.classRunId).filter((x): x is string => !!x))]
  const enrollments = await prisma.classEnrollment.findMany({
    where: { classRunId: { in: runIds }, status: { in: ['ENROLLED', 'WAITLISTED'] } },
    select: { classRunId: true, status: true, type: true, dropInSessionId: true },
  })

  // FULL enrolments attend every session of their run; drop-ins only their one.
  const fullEnrolled = new Map<string, number>(), fullWait = new Map<string, number>()
  const dropEnrolled = new Map<string, number>(), dropWait = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string | null) => { if (k) m.set(k, (m.get(k) ?? 0) + 1) }
  for (const e of enrollments) {
    const enrolled = e.status === 'ENROLLED'
    if (e.type === 'FULL') bump(enrolled ? fullEnrolled : fullWait, e.classRunId)
    else bump(enrolled ? dropEnrolled : dropWait, e.dropInSessionId)
  }

  const partLabels = new Map<string, string>()
  const cells: Record<string, Record<string, WeekBoardCell>> = {}
  let totalBooked = 0
  for (const s of sessions) {
    const colKey = colByKey.get(tzDateKey(s.scheduledAt, tz))
    if (!colKey) continue
    const partKey = tzTimeKey(s.scheduledAt, tz)
    if (!partLabels.has(partKey)) partLabels.set(partKey, tzTimeLabel(s.scheduledAt, tz))
    const capacity = s.packageSessionSlot?.capacity ?? s.classRun?.capacity ?? s.classRun?.package.capacity ?? null
    const booked = (s.classRunId ? fullEnrolled.get(s.classRunId) ?? 0 : 0) + (dropEnrolled.get(s.id) ?? 0)
    const waitlist = (s.classRunId ? fullWait.get(s.classRunId) ?? 0 : 0) + (dropWait.get(s.id) ?? 0)
    totalBooked += booked
    ;(cells[partKey] ??= {})[colKey] = { booked, capacity, waitlist }
  }

  const partsArr = [...partLabels.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, label]) => ({ key, label }))
  return { tz, columns, parts: partsArr, cells, totalBooked }
}
