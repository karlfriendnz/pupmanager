// PRIME PUPS / "Journey Dog Training" data importer.
//
// Loads the extracted xlsx data (clients, courses, enrolments, waitlist) into
// the LOCAL DEV database ONLY, scoped entirely to one target trainer.
//
// SAFETY — run ONLY against local dev:
//   dotenv -e .env.development.local -- tsx scripts/prime/import.ts [--reset]
// NEVER load .env.local (its DATABASE_URL points at PROD). This script only
// ever reads/writes rows scoped to TARGET.trainerId.
//
// It deliberately does NOT import anything from @/lib/* that pulls in
// @/lib/env (prisma.ts, billing.ts, class-runs.ts, …) — those trigger env
// validation and crash under dotenv. The real app's creation logic
// (findOrJoinClient in src/lib/client-upsert.ts, the no-email placeholder in
// src/app/api/clients/route.ts, createClassWithPackage/enrollInRun in
// src/lib/class-runs.ts) is replicated inline against scriptPrisma.

import crypto from 'crypto'
import { readFileSync } from 'fs'
import { scriptPrisma } from '../../src/lib/prisma-script'

const prisma = scriptPrisma()

// ─── Target (already created — see task) ─────────────────────────────────────
const TARGET = {
  trainerId: 'cmrvfbujb0002pg8okc4ssnqv', // TrainerProfile.id (= companyId)
  ownerUserId: 'cmrvfbuhb0000pg8o0ledy0q9',
  login: 'journey@pupmanager.dev',
} as const

const DATA_PATH = '/Users/karl/Desktop/Temp/prime_extracted.json'

// ─── Tunable: sessions per course, keyed per level ───────────────────────────
// Trivially editable. Falls back to DEFAULT for any unknown sheet/level.
const SESSIONS_PER_COURSE: Record<string, number> = {
  'Early Learning': 5,
  'School Pups': 5,
  'Top Teens': 5,
}
const SESSIONS_PER_COURSE_DEFAULT = 5
const WEEKS_BETWEEN = 1 // weekly cadence
const DEFAULT_DURATION_MINS = 60
const FALLBACK_YEAR = 2025
const QUICK_ADD_FOLLOW_UP_STATUS = 'NEW' // mirrors src/lib/client-fields.ts (waitlist leads land here)

// ─── Types mirroring prime_extracted.json ────────────────────────────────────
interface Course {
  id: number
  sheet: string
  nickname: string | null
  day: string | null
  date: string | null
  time: string | null
  location: string | null
  headerRaw: string | null
}
interface Enrolment {
  courseId: number
  name: string
  email: string | null
  phone: string | null
  address: string | null
  dog: string | null
  breed: string | null
  age: string | null
  dateBooked: string | null
  notes: string | null
  sourceSheet: string
  sourceRow: number
  sourceCode: string
}
interface Client {
  name: string
  email: string | null
  phone: string | null
  address: string | null
  dogs: string[]
  courseIds: number[]
  notes: string | null
  sourceRows: string[]
  multipleNamesOnKey: boolean
}
interface Waitlist {
  category: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  dog: string | null
  breedAge: string | null
  notes: string | null
  sourceRow: number
}
interface Extracted {
  courses: Course[]
  enrolments: Enrolment[]
  clients: Client[]
  waitlist: Waitlist[]
  needsReview: unknown[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function placeholderEmail(): string {
  // Matches src/app/api/clients/route.ts — random per-create, never deduped on.
  return `noemail-${crypto.randomBytes(8).toString('hex')}@no-email.pupmanager.app`
}

function normName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function courseName(c: Course): string {
  const nick = c.nickname?.trim()
  return nick ? `${c.sheet} — ${nick}` : `${c.sheet} — Class ${c.id}`
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
}

function parseDayMonth(date: string | null): { dom: number; monthIndex: number } | null {
  if (!date) return null
  const m = date.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]+)/)
  if (!m) return null
  const dom = parseInt(m[1], 10)
  const mi = MONTHS[m[2].toLowerCase()]
  if (mi == null || !dom) return null
  return { dom, monthIndex: mi }
}

function parseTimeToken(tok: string): { h: number; m: number; mer: 'am' | 'pm' | null } | null {
  const t = tok.trim().toLowerCase()
  if (!t) return null
  const mer = /pm/.test(t) ? 'pm' : /am/.test(t) ? 'am' : null
  const nums = t.replace(/[^0-9:]/g, '')
  if (!nums) return null
  const [hStr, mStr] = nums.split(':')
  const h = parseInt(hStr, 10)
  if (isNaN(h)) return null
  const m = mStr ? parseInt(mStr, 10) : 0
  return { h, m: isNaN(m) ? 0 : m, mer }
}

function to24h(h: number, mer: 'am' | 'pm' | null): number {
  if (mer === 'pm') return h < 12 ? h + 12 : h
  if (mer === 'am') return h === 12 ? 0 : h
  return h
}

/** "2:00 - 3:00PM" → { startH:14, startM:0, durationMins:60 }. Fallback 60min. */
function parseTimeRange(time: string | null): { startH: number; startM: number; durationMins: number } {
  const fallback = { startH: 10, startM: 0, durationMins: DEFAULT_DURATION_MINS }
  if (!time) return fallback
  const parts = time.split(/[-–—]/).map(s => s.trim()).filter(Boolean)
  const start = parseTimeToken(parts[0] ?? '')
  if (!start) return fallback
  const end = parts[1] ? parseTimeToken(parts[1]) : null
  // A bare start ("2:00") inherits the end's meridiem ("3:00PM" ⇒ start is PM).
  const startMer = start.mer ?? end?.mer ?? null
  const startH = to24h(start.h, startMer)
  let durationMins = DEFAULT_DURATION_MINS
  if (end) {
    const endMer = end.mer ?? startMer
    const endH = to24h(end.h, endMer)
    const diff = endH * 60 + end.m - (startH * 60 + start.m)
    durationMins = diff > 0 ? diff : DEFAULT_DURATION_MINS
  }
  return { startH, startM: start.m, durationMins }
}

/** Year among ISO (YYYY-MM-DD) dateBooked values; most common wins. */
function yearFromEnrolments(enrols: Enrolment[]): number | null {
  const counts = new Map<number, number>()
  for (const e of enrols) {
    const m = e.dateBooked?.match(/^(\d{4})-\d{2}-\d{2}$/)
    if (m) {
      const y = parseInt(m[1], 10)
      counts.set(y, (counts.get(y) ?? 0) + 1)
    }
  }
  if (counts.size === 0) return null
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
}

// ─── Client dog collection: merge client.dogs[] names + enrolment dog/breed/age
interface DogSpec { name: string; breed: string | null; notes: string | null }
function collectDogs(client: Client, enrols: Enrolment[]): DogSpec[] {
  const named = new Map<string, { name: string; breed: string | null; age: string | null }>()
  const nameless: { breed: string | null; age: string | null }[] = []
  const add = (name: string | null, breed: string | null, age: string | null) => {
    const n = (name ?? '').trim()
    const b = breed?.trim() || null
    const a = age?.trim() || null
    if (n) {
      const k = n.toLowerCase()
      const cur = named.get(k) ?? { name: n, breed: null, age: null }
      if (b && !cur.breed) cur.breed = b
      if (a && !cur.age) cur.age = a
      named.set(k, cur)
    } else if (b || a) {
      nameless.push({ breed: b, age: a })
    }
  }
  for (const e of enrols) add(e.dog, e.breed, e.age)
  for (const dn of client.dogs ?? []) add(dn, null, null)

  const list = [...named.values()]
  if (nameless.length && list.length) {
    // Attach loose breed/age (dog name blank in source) to a named dog missing it.
    for (const nl of nameless) {
      const target = list.find(d => !d.breed || !d.age) ?? list[0]
      if (nl.breed && !target.breed) target.breed = nl.breed
      if (nl.age && !target.age) target.age = nl.age
    }
  } else if (nameless.length && list.length === 0) {
    const nl = nameless[0]
    list.push({ name: 'Puppy', breed: nl.breed, age: nl.age })
  }
  return list.map(d => ({
    name: d.name,
    breed: d.breed,
    notes: d.age ? `Age at intake: ${d.age}` : null,
  }))
}

function buildClientNotes(client: Client, courseNamesForClient: string[]): string | null {
  const parts: string[] = []
  if (client.notes?.trim()) parts.push(client.notes.trim())
  if (courseNamesForClient.length) parts.push(`Courses: ${courseNamesForClient.join('; ')}`)
  if (client.multipleNamesOnKey) parts.push('(Multiple names on original booking key — couple/household.)')
  const joined = parts.join('\n')
  return joined.trim() || null
}

// ─── Reset: delete ONLY this trainer's imported data ─────────────────────────
async function reset() {
  const T = TARGET.trainerId
  console.log(`\n[reset] Deleting all data scoped to trainerId=${T} …`)

  const dr1 = await prisma.sessionAttendance.deleteMany({ where: { session: { trainerId: T } } })
  const dr2 = await prisma.classEnrollment.deleteMany({ where: { classRun: { trainerId: T } } })
  const dr3 = await prisma.classRunTrainer.deleteMany({ where: { classRun: { trainerId: T } } })
  const dr4 = await prisma.trainingSession.deleteMany({ where: { trainerId: T } })
  const dr5 = await prisma.classRun.deleteMany({ where: { trainerId: T } })
  const dr6 = await prisma.package.deleteMany({ where: { trainerId: T } })

  // Clients + dogs. Primary dogs are referenced by ClientProfile.dogId and carry
  // no clientProfileId, so release that FK first, then delete additional dogs,
  // profiles, and finally the (now-unreferenced) primary dogs.
  const profiles = await prisma.clientProfile.findMany({
    where: { trainerId: T },
    select: { id: true, userId: true, dogId: true },
  })
  const profileIds = profiles.map(p => p.id)
  const userIds = [...new Set(profiles.map(p => p.userId))]
  const primaryDogIds = profiles.map(p => p.dogId).filter((d): d is string => !!d)

  await prisma.clientProfile.updateMany({ where: { trainerId: T }, data: { dogId: null } })
  const drDogsA = await prisma.dog.deleteMany({ where: { clientProfileId: { in: profileIds } } })
  const drProfiles = await prisma.clientProfile.deleteMany({ where: { trainerId: T } })
  const drDogsP = await prisma.dog.deleteMany({ where: { id: { in: primaryDogIds } } })
  // Delete Users we created that are now orphaned (no remaining profile). Never
  // touches the trainer owner (they're a TRAINER and not in this client set).
  const drUsers = await prisma.user.deleteMany({
    where: { id: { in: userIds }, role: 'CLIENT', clientProfiles: { none: {} } },
  })

  console.log(
    `[reset] attendance=${dr1.count} enrolments=${dr2.count} runTrainers=${dr3.count} ` +
    `sessions=${dr4.count} classRuns=${dr5.count} packages=${dr6.count} ` +
    `dogs=${drDogsA.count + drDogsP.count} profiles=${drProfiles.count} users=${drUsers.count}`,
  )
}

// ─── Client upsert (find-or-join / no-email), replicated inline ──────────────
const stats = {
  clientsCreated: 0, clientsUpdated: 0, dogsCreated: 0,
  coursesCreated: 0, coursesSkipped: 0, packagesCreated: 0, classRunsCreated: 0, sessionsCreated: 0,
  enrolmentsCreated: 0, enrolmentsSkipped: 0, enrolmentsUnmatched: 0,
  waitlistCreated: 0, waitlistUpdated: 0,
  noEmailClients: 0,
}

/**
 * Find-or-create a ClientProfile for TARGET.trainer. Dedup order: email → phone
 * → normalized name. Returns the profile id. Idempotent (re-runnable).
 */
async function upsertClient(input: {
  name: string
  email: string | null
  phone: string | null
  address: string | null
  dogs: DogSpec[]
  notes: string | null
  status: string
}): Promise<{ profileId: string; created: boolean }> {
  const T = TARGET.trainerId
  const name = (input.name ?? '').trim() || 'New contact'
  const phone = input.phone?.trim() || null
  const address = input.address?.trim() || null

  // ── Locate an existing profile for this trainer ──
  let existing: { id: string; dogId: string | null; phone: string | null; addressLine: string | null; notes: string | null } | null = null
  const sel = { id: true, dogId: true, phone: true, addressLine: true, notes: true } as const

  const realEmail = input.email?.trim() || null
  if (realEmail) {
    const user = await prisma.user.findUnique({ where: { email: realEmail }, select: { id: true } })
    if (user) {
      existing = await prisma.clientProfile.findUnique({
        where: { userId_trainerId: { userId: user.id, trainerId: T } },
        select: sel,
      })
    }
  }
  if (!existing && phone) {
    existing = await prisma.clientProfile.findFirst({ where: { trainerId: T, phone }, select: sel })
  }
  if (!existing) {
    const candidates = await prisma.clientProfile.findMany({
      where: { trainerId: T, user: { name: { equals: name, mode: 'insensitive' } } },
      select: sel,
    })
    if (candidates.length === 1) existing = candidates[0]
  }

  const dogsToCreate = input.dogs.filter(d => d.name.trim())

  if (existing) {
    // ── JOIN / update. Backfill contact fields only where null; refresh notes. ──
    const data: Record<string, unknown> = {}
    if (existing.phone == null && phone) data.phone = phone
    if (existing.addressLine == null && address) data.addressLine = address
    // APPEND notes (never clobber course history); idempotent via substring check.
    if (input.notes) {
      const cur = existing.notes?.trim() ?? ''
      if (!cur) data.notes = input.notes
      else if (!cur.includes(input.notes)) data.notes = `${cur}\n${input.notes}`
    }
    // Attach any dogs not already on the profile (dedup by name).
    const already = await prisma.dog.findMany({
      where: { OR: [{ clientProfileId: existing.id }, { primaryFor: { some: { id: existing.id } } }] },
      select: { name: true },
    })
    const haveNames = new Set(already.map(d => d.name.trim().toLowerCase()))
    const newDogs = dogsToCreate.filter(d => !haveNames.has(d.name.trim().toLowerCase()))
    const createdDogIds: string[] = []
    for (const d of newDogs) {
      const dog = await prisma.dog.create({
        data: { name: d.name.trim(), breed: d.breed, notes: d.notes, clientProfileId: existing.id },
        select: { id: true },
      })
      createdDogIds.push(dog.id)
      stats.dogsCreated++
    }
    if (existing.dogId == null && createdDogIds.length) data.dogId = createdDogIds[0]
    if (Object.keys(data).length) {
      await prisma.clientProfile.update({ where: { id: existing.id }, data })
    }
    return { profileId: existing.id, created: false }
  }

  // ── Create fresh. Real email → reuse/create User by email; else placeholder. ──
  const email = realEmail ?? placeholderEmail()
  if (!realEmail) stats.noEmailClients++

  const user = realEmail
    ? await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, name, role: 'CLIENT' },
        select: { id: true },
      })
    : await prisma.user.create({ data: { email, name, role: 'CLIENT' }, select: { id: true } })

  // Dogs first so the first becomes the primary.
  const dogIds: string[] = []
  for (const d of dogsToCreate) {
    const dog = await prisma.dog.create({
      data: { name: d.name.trim(), breed: d.breed, notes: d.notes },
      select: { id: true },
    })
    dogIds.push(dog.id)
    stats.dogsCreated++
  }

  const profile = await prisma.clientProfile.create({
    data: {
      userId: user.id,
      trainerId: T,
      status: input.status,
      phone,
      addressLine: address,
      dogId: dogIds[0] ?? null,
      notes: input.notes,
      dogs: dogIds.length > 1 ? { connect: dogIds.slice(1).map(id => ({ id })) } : undefined,
    },
    select: { id: true },
  })
  // Additional dogs need clientProfileId set (connect only wires the relation on
  // the profile side for the M2M-style additional relation; set it explicitly).
  if (dogIds.length > 1) {
    await prisma.dog.updateMany({ where: { id: { in: dogIds.slice(1) } }, data: { clientProfileId: profile.id } })
  }
  return { profileId: profile.id, created: true }
}

// ─── Course → Package + ClassRun + sessions ──────────────────────────────────
async function upsertCourse(c: Course, startDate: Date, durationMins: number): Promise<string | null> {
  const T = TARGET.trainerId
  const name = courseName(c)
  const sessionCount = SESSIONS_PER_COURSE[c.sheet] ?? SESSIONS_PER_COURSE_DEFAULT

  // Idempotency: an existing run with the same name under this trainer = skip.
  const existingRun = await prisma.classRun.findFirst({ where: { trainerId: T, name }, select: { id: true } })
  if (existingRun) {
    stats.coursesSkipped++
    return existingRun.id
  }

  const scheduleNote = [
    [c.day, c.date, c.time].filter(Boolean).join(' '),
    c.location ? `@ ${c.location}` : '',
    c.headerRaw ? `· ${c.headerRaw}` : '',
  ].filter(Boolean).join(' ').trim() || null

  const runId = await prisma.$transaction(async tx => {
    const pkg = await tx.package.create({
      data: {
        trainerId: T,
        name,
        sessionCount,
        weeksBetween: WEEKS_BETWEEN,
        durationMins,
        sessionType: 'IN_PERSON',
        isGroup: true,
        order: 0,
      },
      select: { id: true },
    })
    const run = await tx.classRun.create({
      data: { trainerId: T, packageId: pkg.id, name, scheduleNote, startDate },
      select: { id: true },
    })
    // Weekly session series.
    const rows = Array.from({ length: sessionCount }, (_, i) => {
      const d = new Date(startDate)
      d.setDate(d.getDate() + i * WEEKS_BETWEEN * 7)
      return {
        trainerId: T,
        classRunId: run.id,
        sessionIndex: i + 1,
        title: sessionCount > 1 ? `${name} — session ${i + 1}/${sessionCount}` : name,
        scheduledAt: d,
        durationMins,
        bufferMins: 0,
        sessionType: 'IN_PERSON' as const,
        location: c.location?.trim() || null,
      }
    })
    await tx.trainingSession.createMany({ data: rows })
    stats.packagesCreated++
    stats.classRunsCreated++
    stats.sessionsCreated += rows.length
    return run.id
  })
  stats.coursesCreated++
  return runId
}

// ─── Enrol a client into a run (replicates enrollInRun, no capacity gating) ───
async function enrol(runId: string, clientProfileId: string, dogId: string | null) {
  const existing = await prisma.classEnrollment.findFirst({
    where: { classRunId: runId, clientId: clientProfileId, dogId: dogId ?? null },
    select: { id: true },
  })
  if (existing) { stats.enrolmentsSkipped++; return }
  await prisma.classEnrollment.create({
    data: {
      classRunId: runId,
      clientId: clientProfileId,
      dogId: dogId ?? null,
      type: 'FULL',
      status: 'ENROLLED',
      source: 'TRAINER',
    },
  })
  stats.enrolmentsCreated++
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const doReset = process.argv.includes('--reset')

  // Guardrail: confirm we're pointed at a local dev DB.
  const dbUrl = process.env.DATABASE_URL ?? ''
  if (!/localhost|127\.0\.0\.1/.test(dbUrl) || !/pupmanager_dev/.test(dbUrl)) {
    throw new Error(`Refusing to run: DATABASE_URL is not local pupmanager_dev (got "${dbUrl.replace(/:[^@]*@/, ':***@')}")`)
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: TARGET.trainerId }, select: { id: true, businessName: true, user: { select: { email: true } } },
  })
  if (!trainer) throw new Error(`Target trainer ${TARGET.trainerId} not found in this DB`)
  console.log(`Target trainer: ${trainer.businessName} (${trainer.user.email})  id=${trainer.id}`)

  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8')) as Extracted
  console.log(`Loaded: ${data.courses.length} courses, ${data.clients.length} clients, ${data.enrolments.length} enrolments, ${data.waitlist.length} waitlist`)

  if (doReset) await reset()

  // ── Index enrolments by course + build sourceCode → client lookup ──
  const enrolsByCourse = new Map<number, Enrolment[]>()
  for (const e of data.enrolments) {
    if (!enrolsByCourse.has(e.courseId)) enrolsByCourse.set(e.courseId, [])
    enrolsByCourse.get(e.courseId)!.push(e)
  }
  const codeToClientIndex = new Map<string, number>()
  data.clients.forEach((c, i) => (c.sourceRows ?? []).forEach(sr => codeToClientIndex.set(sr, i)))

  // ── 1 + 2: courses (Package + ClassRun + sessions) with year inference ──
  console.log('\n[courses] Creating packages, class runs, sessions …')

  // Per-sheet roll-forward fallback: walk courses in id order, roll year on
  // month decrease, seeded/overridden by any enrolment-derived year.
  const coursesBySheet = new Map<string, Course[]>()
  for (const c of data.courses) {
    if (!coursesBySheet.has(c.sheet)) coursesBySheet.set(c.sheet, [])
    coursesBySheet.get(c.sheet)!.push(c)
  }
  const courseYear = new Map<number, number>()
  for (const [, courses] of coursesBySheet) {
    const ordered = [...courses].sort((a, b) => a.id - b.id)
    let running: number | null = null
    let prevMonth: number | null = null
    for (const c of ordered) {
      const dm = parseDayMonth(c.date)
      const enrolYear = yearFromEnrolments(enrolsByCourse.get(c.id) ?? [])
      let year: number
      if (enrolYear != null) {
        year = enrolYear
        running = enrolYear
      } else if (running == null) {
        year = FALLBACK_YEAR
        running = FALLBACK_YEAR
      } else {
        if (dm && prevMonth != null && dm.monthIndex < prevMonth) running += 1
        year = running
      }
      if (dm) prevMonth = dm.monthIndex
      courseYear.set(c.id, year)
    }
  }

  const runIdByCourse = new Map<number, string>()
  for (const c of data.courses) {
    const dm = parseDayMonth(c.date)
    const { startH, startM, durationMins } = parseTimeRange(c.time)
    const year = courseYear.get(c.id) ?? FALLBACK_YEAR
    // Fallback day/month if unparseable: Jan 1.
    const startDate = new Date(year, dm ? dm.monthIndex : 0, dm ? dm.dom : 1, startH, startM, 0, 0)
    const runId = await upsertCourse(c, startDate, durationMins)
    if (runId) runIdByCourse.set(c.id, runId)
  }

  // ── 3: clients (dedup) — build per-client dog + notes from their enrolments ──
  console.log('\n[clients] Creating client profiles + dogs …')
  const clientProfileIdByIndex = new Map<number, string>()
  const clientPrimaryDogNameByIndex = new Map<number, string | null>()

  for (let i = 0; i < data.clients.length; i++) {
    const client = data.clients[i]
    // Gather this client's enrolments (via their sourceRows/sourceCodes).
    const codes = new Set(client.sourceRows ?? [])
    const enrols = data.enrolments.filter(e => codes.has(e.sourceCode))
    const dogs = collectDogs(client, enrols)
    const courseNamesForClient = [...new Set(client.courseIds
      .map(id => data.courses.find(c => c.id === id))
      .filter((c): c is Course => !!c)
      .map(c => courseName(c)))]
    const notes = buildClientNotes(client, courseNamesForClient)

    const { profileId, created } = await upsertClient({
      name: client.name,
      email: client.email,
      phone: client.phone,
      address: client.address,
      dogs,
      notes,
      status: 'ACTIVE',
    })
    if (created) stats.clientsCreated++
    else stats.clientsUpdated++
    clientProfileIdByIndex.set(i, profileId)
    clientPrimaryDogNameByIndex.set(i, dogs[0]?.name ?? null)
  }

  // ── 3b: enrolments → ClassEnrollment ──
  console.log('\n[enrolments] Linking clients to class runs …')
  for (const e of data.enrolments) {
    const ci = codeToClientIndex.get(e.sourceCode)
    let profileId = ci != null ? clientProfileIdByIndex.get(ci) : undefined
    // Fallbacks: email → phone → normalized name against created profiles.
    if (!profileId) {
      const fi = data.clients.findIndex(c =>
        (e.email && c.email && c.email.trim().toLowerCase() === e.email.trim().toLowerCase()) ||
        (e.phone && c.phone && c.phone.trim() === e.phone.trim()) ||
        normName(c.name) === normName(e.name))
      if (fi >= 0) profileId = clientProfileIdByIndex.get(fi)
    }
    const runId = runIdByCourse.get(e.courseId)
    if (!profileId || !runId) { stats.enrolmentsUnmatched++; continue }

    // Pick the client's dog: prefer a dog whose name matches this enrolment's.
    let dogId: string | null = null
    const wantName = (e.dog ?? '').trim().toLowerCase()
    const profileDogs = await prisma.dog.findMany({
      where: { OR: [{ clientProfileId: profileId }, { primaryFor: { some: { id: profileId } } }] },
      select: { id: true, name: true },
    })
    if (wantName) dogId = profileDogs.find(d => d.name.trim().toLowerCase() === wantName)?.id ?? null
    if (!dogId) {
      const prof = await prisma.clientProfile.findUnique({ where: { id: profileId }, select: { dogId: true } })
      dogId = prof?.dogId ?? profileDogs[0]?.id ?? null
    }
    await enrol(runId, profileId, dogId)
  }

  // ── 4: waitlist → ClientProfile leads (status NEW) ──
  console.log('\n[waitlist] Creating waitlist leads …')
  for (const w of data.waitlist) {
    const extra = [w.breedAge?.trim(), w.notes?.trim()].filter(Boolean).join(' | ')
    const note = `Waitlist (${w.category}): ${extra || '—'}`
    const dogs: DogSpec[] = w.dog?.trim()
      ? [{ name: w.dog.trim(), breed: null, notes: w.breedAge?.trim() ? `Breed/age: ${w.breedAge.trim()}` : null }]
      : []
    const { created } = await upsertClient({
      name: w.name,
      email: w.email,
      phone: w.phone,
      address: w.address,
      dogs,
      notes: note,
      status: QUICK_ADD_FOLLOW_UP_STATUS,
    })
    if (created) stats.waitlistCreated++
    else stats.waitlistUpdated++
  }

  // ── Report ──
  console.log('\n════════════════════ IMPORT COMPLETE ════════════════════')
  console.table(stats)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async err => {
    console.error('\n[import] FAILED:', err)
    await prisma.$disconnect()
    process.exit(1)
  })
