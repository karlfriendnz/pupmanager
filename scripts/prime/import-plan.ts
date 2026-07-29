// PRIME PUPS / "Journey Dog Training" — MERGED PLAN importer.
//
// Loads /Users/karl/Desktop/Temp/import_plan.json (the reconciled merge of the
// booking spreadsheet + contacts export + professionals.csv + subscribers.csv)
// into the LOCAL DEV database ONLY, scoped entirely to one target trainer.
//
// SAFETY — run ONLY against local dev (the -o is load-bearing: DATABASE_URL is
// exported in the ambient shell pointing at a REMOTE database and dotenv will
// not replace it without --override):
//
//   ./node_modules/.bin/dotenv -e .env.development.local -o -- \
//     npx tsx scripts/prime/import-plan.ts [--reset]
//
// assertLocalDb() below is the backstop. Never run any Prisma CLI write command
// for this work — `prisma migrate/db push/db execute` resolve DIRECT_URL, which
// .env fills with PRODUCTION.
//
// Shape of the import (deliberately mirrors scripts/prime/import.ts, which
// already maps a course → Package + ClassRun + generated TrainingSessions):
//
//   people[]            → User (CLIENT) + ClientProfile (+ CustomFieldValue)
//   people[].dogs[]     → Dog (first = ClientProfile.dogId primary, rest additional)
//   courses[]           → Package + ClassRun + N weekly TrainingSessions
//   people[].enrolments → ClassEnrollment
//   subscribers[]       → Subscriber
//   people[].oneToOneConsults → Package (1:1, isGroup=false) + ClientPackage
//   notes/accessCodes/afRefs/waitlist → ClientProfile.notes (labelled lines)
//
// Idempotent: re-running creates nothing new. --reset clears only this
// trainer's imported rows first.

import crypto from 'crypto'
import { readFileSync } from 'fs'
import { scriptPrisma } from '../../src/lib/prisma-script'

const prisma = scriptPrisma()

// Defaults to the local sandbox trainer. The LIVE account has a different owner
// address, so a production run must name it: PRIME_TRAINER_EMAIL=...
const TRAINER_EMAIL = process.env.PRIME_TRAINER_EMAIL ?? 'journey@pupmanager.dev'
const PLAN_PATH = '/Users/karl/Desktop/Temp/import_plan.json'
// Only used to infer the YEAR of each spreadsheet course (the plan carries the
// day+month but not the booking dates). Optional — falls back if missing.
const EXTRACTED_PATH = '/Users/karl/Desktop/Temp/prime_extracted.json'

// ─── Tunables ────────────────────────────────────────────────────────────────
const SESSIONS_PER_COURSE: Record<string, number> = {
  'Early Learning': 5,
  'School Pups': 5,
  'Top Teens': 5,
}
const SESSIONS_PER_COURSE_DEFAULT = 5
const WEEKS_BETWEEN = 1
const DEFAULT_DURATION_MINS = 60
const FALLBACK_YEAR = 2025
// Courses the plan reconstructed from contact notes (no spreadsheet header row)
// get this suffix so the trainer can find and rename them.
const RECONSTRUCTED_SUFFIX = ' [reconstructed]'
const UNKNOWN_CONSULT_DATE = new Date(FALLBACK_YEAR, 0, 1)
const UNNAMED_DOG = 'Unnamed dog'
const LEAD_STATUS = 'NEW' // mirrors src/lib/client-fields.ts (leads land here)

// ─── Plan types ──────────────────────────────────────────────────────────────
interface PlanDog {
  name: string
  breed: string | null
  deceasedAt: string | null
  notes: string[]
  flags: string[]
}
interface PlanEnrolment {
  courseId: string
  courseName: string
  courseOrigin: string
  level: string
  dog: string
  didNotAttend: boolean
  priorProvider: boolean
}
interface PlanConsult {
  code: string
  service: string
  month: string | null
  year: string | null
  raw: string
  source: string
}
interface PlanWaitlist {
  category: string
  breedAge: string | null
  dogRaw: string | null
  notes: string | null
}
interface PlanAfRef { number: string | null; raw: string; bare: boolean }
interface PlanPerson {
  id: string
  firstName: string
  lastName: string
  fullName: string
  email: string | null
  emailIsPlaceholder: boolean
  phone: string | null
  address: string | null
  city: string | null
  postcode: string | null
  company: string | null
  dogs: PlanDog[]
  enrolments: PlanEnrolment[]
  oneToOneConsults: PlanConsult[]
  customFields: Record<string, string>
  notes: string | null
  accessCodes: string[]
  afRefs: PlanAfRef[]
  waitlist: PlanWaitlist[]
  isSubscriber: boolean
  flags: string[]
}
interface PlanCourse {
  id: string
  origin: 'spreadsheet' | 'invented'
  spreadsheetCourseId: number | null
  level: string
  code: string
  name: string
  nickname: string | null
  day: string | null
  date: string | null
  month: string | null
  year: string | null
  time: string | null
  location: string | null
  headerRaw: string | null
  flags: string[]
  probableSpreadsheetMatch?: string
}
interface PlanSubscriber {
  email: string
  name: string | null
  personId: string | null
  linkedBy: string
  acceptsMarketing: string
  createdOn: string | null
}
interface Plan {
  people: PlanPerson[]
  courses: PlanCourse[]
  subscribers: PlanSubscriber[]
}

// ─── Safety ──────────────────────────────────────────────────────────────────
function assertLocalDb() {
  const url = process.env.DATABASE_URL ?? ''
  const local = /localhost|127\.0\.0\.1/.test(url) && /pupmanager_dev/.test(url)
  if (!local) {
    console.error('\n✋ Refusing to run: DATABASE_URL is not local pupmanager_dev.')
    console.error(`   got: ${url.replace(/:[^@]*@/, ':***@') || '(empty)'}`)
    console.error('   Run with: ./node_modules/.bin/dotenv -e .env.development.local -o -- npx tsx scripts/prime/import-plan.ts\n')
    process.exit(1)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Placeholder address for a person with no email in any source. Matches the
 * app's pattern (src/app/api/clients/route.ts) but the 16 hex digits are
 * DERIVED FROM THE PLAN PERSON ID rather than random, so a re-run recognises
 * the same person instead of creating a second copy. Still unique per person
 * and still on the no-email domain, so it can never merge with anyone.
 */
function placeholderEmail(personId: string): string {
  const hex = crypto.createHash('md5').update(`prime:${personId}`).digest('hex').slice(0, 16)
  return `noemail-${hex}@no-email.pupmanager.app`
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

/** "2:00 - 3:00PM" → { startH:14, startM:0, durationMins:60 }. */
function parseTimeRange(time: string | null): { startH: number; startM: number; durationMins: number } {
  const fallback = { startH: 10, startM: 0, durationMins: DEFAULT_DURATION_MINS }
  if (!time) return fallback
  const parts = time.split(/[-–—]/).map(s => s.trim()).filter(Boolean)
  const start = parseTimeToken(parts[0] ?? '')
  if (!start) return fallback
  const end = parts[1] ? parseTimeToken(parts[1]) : null
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

function composeAddress(p: PlanPerson): string | null {
  const addr = p.address?.trim() || ''
  const city = p.city?.trim() || ''
  const post = p.postcode?.trim() || ''
  const parts: string[] = []
  if (addr) parts.push(addr)
  if (city && !addr.toLowerCase().includes(city.toLowerCase())) parts.push(city)
  if (post && !addr.includes(post)) parts.push(post)
  const joined = parts.join(', ').trim()
  return joined || null
}

function consultLabel(c: PlanConsult): string {
  const when = [c.month, c.year].filter(Boolean).join(' ')
  return `${c.service}${when ? ` — ${when}` : ''}`
}

/**
 * Everything about a person that has no column of its own, as labelled lines on
 * ClientProfile.notes. Access codes are labelled so they can never be mistaken
 * for free text; AF refs, waitlist rows and 1:1 history are kept verbatim.
 */
function buildNotes(p: PlanPerson): string | null {
  const lines: string[] = []
  if (p.notes?.trim()) lines.push(p.notes.trim())
  if (p.company?.trim()) lines.push(`Business: ${p.company.trim()}`)
  for (const code of p.accessCodes ?? []) lines.push(`Access code: ${code.trim()}`)
  for (const ref of p.afRefs ?? []) {
    lines.push(`AF ref: ${ref.number ? `#${ref.number}` : '(number missing)'} — ${ref.raw}`)
  }
  for (const w of p.waitlist ?? []) {
    const extra = [w.dogRaw, w.breedAge, w.notes].map(s => s?.trim()).filter(Boolean).join(' · ')
    lines.push(`Waitlist: ${w.category}${extra ? ` — ${extra}` : ''}`)
  }
  for (const c of p.oneToOneConsults ?? []) {
    lines.push(`1:1: ${consultLabel(c)} — "${c.raw}"`)
  }
  for (const f of p.flags ?? []) lines.push(`Import note: ${f}`)
  const joined = lines.join('\n').trim()
  return joined || null
}

// ─── Stats ───────────────────────────────────────────────────────────────────
const stats = {
  clientsCreated: 0, clientsMerged: 0, clientsExisting: 0,
  dogsCreated: 0, dogsDeceased: 0, dogsUnnamed: 0,
  customFieldValues: 0,
  packagesCreated: 0, classRunsCreated: 0, sessionsCreated: 0, coursesExisting: 0,
  enrolmentsCreated: 0, enrolmentsExisting: 0, enrolmentsUnmatched: 0,
  subscribersCreated: 0, subscribersExisting: 0,
  consultPackagesCreated: 0, clientPackagesCreated: 0, clientPackagesExisting: 0,
  placeholderEmails: 0,
}
const problems: string[] = []

// ─── Reset (this trainer only) ───────────────────────────────────────────────
async function reset(T: string) {
  console.log(`\n[reset] Deleting all imported data for trainerId=${T} …`)

  const attendance = await prisma.sessionAttendance.deleteMany({ where: { session: { trainerId: T } } })
  const enrolments = await prisma.classEnrollment.deleteMany({ where: { classRun: { trainerId: T } } })
  const runTrainers = await prisma.classRunTrainer.deleteMany({ where: { classRun: { trainerId: T } } })
  const sessions = await prisma.trainingSession.deleteMany({ where: { trainerId: T } })
  const clientPkgs = await prisma.clientPackage.deleteMany({ where: { package: { trainerId: T } } })
  const runs = await prisma.classRun.deleteMany({ where: { trainerId: T } })
  const packages = await prisma.package.deleteMany({ where: { trainerId: T } })
  const subs = await prisma.subscriber.deleteMany({ where: { trainerId: T } })

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

  await prisma.customFieldValue.deleteMany({ where: { clientId: { in: profileIds } } })
  await prisma.clientProfile.updateMany({ where: { trainerId: T }, data: { dogId: null } })
  const dogsA = await prisma.dog.deleteMany({ where: { clientProfileId: { in: profileIds } } })
  const profs = await prisma.clientProfile.deleteMany({ where: { trainerId: T } })
  const dogsP = await prisma.dog.deleteMany({ where: { id: { in: primaryDogIds } } })
  const users = await prisma.user.deleteMany({
    where: { id: { in: userIds }, role: 'CLIENT', clientProfiles: { none: {} } },
  })

  console.log(
    `[reset] attendance=${attendance.count} enrolments=${enrolments.count} runTrainers=${runTrainers.count} ` +
    `sessions=${sessions.count} clientPackages=${clientPkgs.count} classRuns=${runs.count} packages=${packages.count} ` +
    `subscribers=${subs.count} dogs=${dogsA.count + dogsP.count} profiles=${profs.count} users=${users.count}`,
  )
}

// ─── Year inference for spreadsheet courses ──────────────────────────────────
/**
 * The plan carries each spreadsheet course's day+month but no year. Recover it
 * the way scripts/prime/import.ts does: take the most common booking year among
 * that course's enrolments in prime_extracted.json, and for courses with no
 * dated booking roll the year forward per level when the month goes backwards.
 */
function inferCourseYears(courses: PlanCourse[]): Map<string, number> {
  let yearBySpreadsheetId = new Map<number, number>()
  try {
    const extracted = JSON.parse(readFileSync(EXTRACTED_PATH, 'utf-8')) as {
      enrolments: { courseId: number; dateBooked: string | null }[]
    }
    const counts = new Map<number, Map<number, number>>()
    for (const e of extracted.enrolments) {
      const m = e.dateBooked?.match(/^(\d{4})-\d{2}-\d{2}$/)
      if (!m) continue
      const y = parseInt(m[1], 10)
      if (!counts.has(e.courseId)) counts.set(e.courseId, new Map())
      const inner = counts.get(e.courseId)!
      inner.set(y, (inner.get(y) ?? 0) + 1)
    }
    yearBySpreadsheetId = new Map(
      [...counts].map(([cid, inner]) => [
        cid,
        [...inner.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0],
      ]),
    )
  } catch {
    problems.push(`Could not read ${EXTRACTED_PATH} — spreadsheet course years fell back to roll-forward only.`)
  }

  const out = new Map<string, number>()
  const byLevel = new Map<string, PlanCourse[]>()
  for (const c of courses) {
    if (c.origin !== 'spreadsheet') continue
    if (!byLevel.has(c.level)) byLevel.set(c.level, [])
    byLevel.get(c.level)!.push(c)
  }
  for (const [, list] of byLevel) {
    const ordered = [...list].sort((a, b) => (a.spreadsheetCourseId ?? 0) - (b.spreadsheetCourseId ?? 0))
    let running: number | null = null
    let prevMonth: number | null = null
    for (const c of ordered) {
      const dm = parseDayMonth(c.date)
      const known = c.spreadsheetCourseId != null ? yearBySpreadsheetId.get(c.spreadsheetCourseId) : undefined
      let year: number
      if (known != null) {
        year = known
        running = known
      } else if (running == null) {
        year = FALLBACK_YEAR
        running = FALLBACK_YEAR
      } else {
        if (dm && prevMonth != null && dm.monthIndex < prevMonth) running += 1
        year = running
      }
      if (dm) prevMonth = dm.monthIndex
      out.set(c.id, year)
    }
  }
  return out
}

function courseStart(c: PlanCourse, year: number): { start: Date; durationMins: number } {
  const { startH, startM, durationMins } = parseTimeRange(c.time)
  if (c.origin === 'spreadsheet') {
    const dm = parseDayMonth(c.date)
    return {
      start: new Date(year, dm ? dm.monthIndex : 0, dm ? dm.dom : 1, startH, startM, 0, 0),
      durationMins,
    }
  }
  // Reconstructed course: only a month + year were recoverable from the notes.
  const mi = c.month ? MONTHS[c.month.trim().toLowerCase()] ?? 0 : 0
  const y = c.year ? parseInt(c.year, 10) || FALLBACK_YEAR : FALLBACK_YEAR
  return { start: new Date(y, mi, 1, startH, startM, 0, 0), durationMins }
}

function runName(c: PlanCourse): string {
  return c.origin === 'invented' ? `${c.name}${RECONSTRUCTED_SUFFIX}` : c.name
}

// ─── Courses → Package + ClassRun + sessions ─────────────────────────────────
async function importCourses(T: string, courses: PlanCourse[]): Promise<Map<string, string>> {
  const years = inferCourseYears(courses)
  const runIdByCourse = new Map<string, string>()

  for (const c of courses) {
    const name = runName(c)
    const existing = await prisma.classRun.findFirst({ where: { trainerId: T, name }, select: { id: true } })
    if (existing) {
      stats.coursesExisting++
      runIdByCourse.set(c.id, existing.id)
      continue
    }

    const { start, durationMins } = courseStart(c, years.get(c.id) ?? FALLBACK_YEAR)
    const sessionCount = SESSIONS_PER_COURSE[c.level] ?? SESSIONS_PER_COURSE_DEFAULT
    const scheduleNote = [
      [c.day, c.date, c.time].filter(Boolean).join(' '),
      c.location ? `@ ${c.location}` : '',
      c.origin === 'invented'
        ? '· RECONSTRUCTED from contact notes — no spreadsheet row; check the dates and rename.'
        : c.headerRaw ? `· ${c.headerRaw}` : '',
      c.flags?.length ? `· ${c.flags.join(' · ')}` : '',
    ].filter(Boolean).join(' ').trim() || null

    const runId = await prisma.$transaction(async tx => {
      const pkg = await tx.package.create({
        data: {
          trainerId: T,
          name,
          description: c.origin === 'invented'
            ? 'Reconstructed from contact notes during the data import — no booking-sheet row exists for this class. Rename/merge as needed.'
            : null,
          sessionCount,
          weeksBetween: WEEKS_BETWEEN,
          durationMins,
          sessionType: 'IN_PERSON',
          isGroup: true,
          location: c.location?.trim() || null,
          order: 0,
        },
        select: { id: true },
      })
      const run = await tx.classRun.create({
        data: {
          trainerId: T,
          packageId: pkg.id,
          name,
          scheduleNote,
          startDate: start,
          location: c.location?.trim() || null,
        },
        select: { id: true },
      })
      const rows = Array.from({ length: sessionCount }, (_, i) => {
        const d = new Date(start)
        d.setDate(d.getDate() + i * WEEKS_BETWEEN * 7)
        return {
          trainerId: T,
          classRunId: run.id,
          sessionIndex: i + 1,
          title: `${name} — session ${i + 1}/${sessionCount}`,
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
    runIdByCourse.set(c.id, runId)
  }
  return runIdByCourse
}

// ─── People → User + ClientProfile + Dogs ────────────────────────────────────
interface Imported { profileId: string; dogIdByName: Map<string, string>; primaryDogId: string | null }

async function importPerson(T: string, p: PlanPerson): Promise<Imported> {
  const name = (p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' ')).trim() || 'New contact'
  const phone = p.phone?.trim() || null
  const address = composeAddress(p)
  const notes = buildNotes(p)
  const status = p.enrolments.length || p.oneToOneConsults.length ? 'ACTIVE' : LEAD_STATUS

  const email = p.emailIsPlaceholder || !p.email?.trim()
    ? placeholderEmail(p.id)
    : p.email.trim().toLowerCase()
  if (p.emailIsPlaceholder || !p.email?.trim()) stats.placeholderEmails++

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role: 'CLIENT' },
    select: { id: true },
  })

  let profile = await prisma.clientProfile.findUnique({
    where: { userId_trainerId: { userId: user.id, trainerId: T } },
    select: { id: true, notes: true, phone: true, addressLine: true, dogId: true },
  })

  if (profile) {
    // Same email seen twice in the plan (or a re-run). Backfill blanks and
    // append notes we don't already carry — never clobber.
    const data: Record<string, unknown> = {}
    if (!profile.phone && phone) data.phone = phone
    if (!profile.addressLine && address) data.addressLine = address
    if (notes) {
      const cur = profile.notes?.trim() ?? ''
      if (!cur) data.notes = notes
      else if (!cur.includes(notes)) data.notes = `${cur}\n${notes}`
    }
    if (Object.keys(data).length) {
      await prisma.clientProfile.update({ where: { id: profile.id }, data })
      stats.clientsMerged++
    } else {
      stats.clientsExisting++
    }
  } else {
    profile = await prisma.clientProfile.create({
      data: {
        userId: user.id,
        trainerId: T,
        status,
        phone,
        addressLine: address,
        notes,
      },
      select: { id: true, notes: true, phone: true, addressLine: true, dogId: true },
    })
    stats.clientsCreated++
  }

  // ── Dogs (dedup by name within the profile) ──
  const existingDogs = await prisma.dog.findMany({
    where: { OR: [{ clientProfileId: profile.id }, { primaryFor: { some: { id: profile.id } } }] },
    select: { id: true, name: true },
  })
  const dogIdByName = new Map(existingDogs.map(d => [d.name.trim().toLowerCase(), d.id]))
  const createdIds: string[] = []

  for (const d of p.dogs ?? []) {
    const rawName = (d.name ?? '').trim()
    const dogName = rawName || UNNAMED_DOG
    if (!rawName) stats.dogsUnnamed++
    const key = dogName.toLowerCase()
    if (dogIdByName.has(key)) continue
    const noteParts = [...(d.notes ?? [])]
    for (const f of d.flags ?? []) noteParts.push(f)
    if (!rawName) noteParts.push('No dog name in any source.')
    const dog = await prisma.dog.create({
      data: {
        name: dogName,
        breed: d.breed?.trim() || null,
        notes: noteParts.length ? noteParts.join('\n') : null,
        deceasedAt: d.deceasedAt ? new Date(`${d.deceasedAt}T00:00:00`) : null,
        // Primary dog is wired via ClientProfile.dogId below; the rest own a
        // clientProfileId. Set it for all, then promote the first.
        clientProfileId: profile.id,
      },
      select: { id: true },
    })
    if (d.deceasedAt) stats.dogsDeceased++
    stats.dogsCreated++
    dogIdByName.set(key, dog.id)
    createdIds.push(dog.id)
  }

  const current = await prisma.clientProfile.findUnique({ where: { id: profile.id }, select: { dogId: true } })
  let primaryDogId = current?.dogId ?? null
  if (!primaryDogId) {
    const firstName = (p.dogs?.[0]?.name ?? '').trim() || (p.dogs?.length ? UNNAMED_DOG : '')
    primaryDogId = (firstName && dogIdByName.get(firstName.toLowerCase())) || createdIds[0] || existingDogs[0]?.id || null
    if (primaryDogId) {
      await prisma.clientProfile.update({ where: { id: profile.id }, data: { dogId: primaryDogId } })
      // The primary dog is referenced through ClientProfile.dogId; drop the
      // additional-dog FK so it isn't listed twice.
      await prisma.dog.update({ where: { id: primaryDogId }, data: { clientProfileId: null } })
    }
  }

  return { profileId: profile.id, dogIdByName, primaryDogId }
}

// ─── Custom field values ─────────────────────────────────────────────────────
async function importCustomFields(p: PlanPerson, profileId: string, fieldIdByLabel: Map<string, string>) {
  for (const [label, value] of Object.entries(p.customFields ?? {})) {
    const fieldId = fieldIdByLabel.get(label.trim().toLowerCase())
    if (!fieldId) {
      problems.push(`No custom field "${label}" on this trainer — value for ${p.id} skipped.`)
      continue
    }
    const val = String(value ?? '').trim()
    if (!val) continue
    const existing = await prisma.customFieldValue.findFirst({
      where: { fieldId, clientId: profileId, dogId: null },
      select: { id: true, value: true },
    })
    if (existing) {
      if (existing.value !== val) {
        await prisma.customFieldValue.update({ where: { id: existing.id }, data: { value: val } })
      }
      continue
    }
    await prisma.customFieldValue.create({ data: { fieldId, clientId: profileId, dogId: null, value: val } })
    stats.customFieldValues++
  }
}

// ─── 1:1 consults → Package (isGroup=false) + ClientPackage ──────────────────
async function consultPackageId(T: string, service: string, cache: Map<string, string>): Promise<string> {
  const key = service.trim().toLowerCase()
  const hit = cache.get(key)
  if (hit) return hit
  const existing = await prisma.package.findFirst({
    where: { trainerId: T, name: service, isGroup: false },
    select: { id: true },
  })
  if (existing) {
    cache.set(key, existing.id)
    return existing.id
  }
  const pkg = await prisma.package.create({
    data: {
      trainerId: T,
      name: service,
      description: 'Imported 1:1 history — the dates come from the contact notes, sessions were not reconstructed.',
      sessionCount: 1,
      weeksBetween: 1,
      durationMins: DEFAULT_DURATION_MINS,
      sessionType: 'IN_PERSON',
      isGroup: false,
      order: 0,
    },
    select: { id: true },
  })
  stats.consultPackagesCreated++
  cache.set(key, pkg.id)
  return pkg.id
}

function consultStart(c: PlanConsult): Date {
  if (!c.year) return UNKNOWN_CONSULT_DATE
  const y = parseInt(c.year, 10)
  if (!y) return UNKNOWN_CONSULT_DATE
  const mi = c.month ? MONTHS[c.month.trim().toLowerCase()] ?? 0 : 0
  return new Date(y, mi, 1, 0, 0, 0, 0)
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  assertLocalDb()
  const doReset = process.argv.includes('--reset')

  const trainerUser = await prisma.user.findUnique({
    where: { email: TRAINER_EMAIL },
    select: { trainerProfile: { select: { id: true, businessName: true } } },
  })
  const T = trainerUser?.trainerProfile?.id
  if (!T) throw new Error(`No trainer profile for ${TRAINER_EMAIL} in this database.`)
  console.log(`Target trainer: ${trainerUser!.trainerProfile!.businessName} (${TRAINER_EMAIL})  id=${T}`)

  const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf-8')) as Plan
  console.log(`Plan: ${plan.people.length} people, ${plan.courses.length} courses, ${plan.subscribers.length} subscribers`)

  if (doReset) await reset(T)

  const fields = await prisma.customField.findMany({ where: { trainerId: T }, select: { id: true, label: true } })
  const fieldIdByLabel = new Map(fields.map(f => [f.label.trim().toLowerCase(), f.id]))

  // ── 1: courses ──
  console.log('\n[courses] Packages + class runs + sessions …')
  const runIdByCourse = await importCourses(T, plan.courses)

  // ── 2: people, dogs, custom fields ──
  console.log('[people] Clients + dogs + custom fields …')
  const importedByPerson = new Map<string, Imported>()
  for (const p of plan.people) {
    try {
      const imported = await importPerson(T, p)
      importedByPerson.set(p.id, imported)
      await importCustomFields(p, imported.profileId, fieldIdByLabel)
    } catch (err) {
      problems.push(`Person ${p.id} (${p.fullName}) FAILED: ${(err as Error).message}`)
    }
  }

  // ── 3: enrolments ──
  console.log('[enrolments] Linking clients to class runs …')
  for (const p of plan.people) {
    const imported = importedByPerson.get(p.id)
    if (!imported) continue
    for (const e of p.enrolments ?? []) {
      const runId = runIdByCourse.get(e.courseId)
      if (!runId) {
        stats.enrolmentsUnmatched++
        problems.push(`Enrolment for ${p.id} references unknown course ${e.courseId}.`)
        continue
      }
      const want = (e.dog ?? '').trim().toLowerCase()
      const dogId = (want && imported.dogIdByName.get(want)) || imported.primaryDogId || null
      const existing = await prisma.classEnrollment.findFirst({
        where: { classRunId: runId, clientId: imported.profileId, dogId: dogId ?? null },
        select: { id: true },
      })
      if (existing) { stats.enrolmentsExisting++; continue }
      try {
        await prisma.classEnrollment.create({
          data: {
            classRunId: runId,
            clientId: imported.profileId,
            dogId: dogId ?? null,
            type: 'FULL',
            status: e.didNotAttend ? 'WITHDRAWN' : 'ENROLLED',
            source: 'TRAINER',
          },
        })
        stats.enrolmentsCreated++
      } catch (err) {
        stats.enrolmentsUnmatched++
        problems.push(`Enrolment ${p.id} → ${e.courseId} FAILED: ${(err as Error).message}`)
      }
    }
  }

  // ── 4: 1:1 consults ──
  console.log('[consults] 1:1 history as client packages …')
  const consultCache = new Map<string, string>()
  for (const p of plan.people) {
    const imported = importedByPerson.get(p.id)
    if (!imported) continue
    for (const c of p.oneToOneConsults ?? []) {
      const pkgId = await consultPackageId(T, c.service, consultCache)
      const startDate = consultStart(c)
      const existing = await prisma.clientPackage.findFirst({
        where: { packageId: pkgId, clientId: imported.profileId, startDate },
        select: { id: true },
      })
      if (existing) { stats.clientPackagesExisting++; continue }
      await prisma.clientPackage.create({
        data: { packageId: pkgId, clientId: imported.profileId, startDate },
      })
      stats.clientPackagesCreated++
    }
  }

  // ── 5: subscribers ──
  console.log('[subscribers] Mailing list …')
  for (const s of plan.subscribers ?? []) {
    const email = s.email?.trim().toLowerCase()
    if (!email) { problems.push('Subscriber row with no email skipped.'); continue }
    const existing = await prisma.subscriber.findUnique({
      where: { trainerId_email: { trainerId: T, email } },
      select: { id: true },
    })
    if (existing) { stats.subscribersExisting++; continue }
    await prisma.subscriber.create({
      data: {
        trainerId: T,
        email,
        name: s.name?.trim() || null,
        status: 'SUBSCRIBED',
        createdAt: parseSubscriberDate(s.createdOn) ?? undefined,
      },
    })
    stats.subscribersCreated++
  }

  console.log('\n════════════════════ IMPORT COMPLETE ════════════════════')
  console.table(stats)
  if (problems.length) {
    console.log(`\n⚠ ${problems.length} problem(s):`)
    for (const line of problems.slice(0, 40)) console.log(`   - ${line}`)
    if (problems.length > 40) console.log(`   … and ${problems.length - 40} more`)
  }
}

/** "June 10, 2024 at 3:14:20 PM NZST" → Date (best effort; null if unparseable). */
function parseSubscriberDate(raw: string | null | undefined): Date | null {
  if (!raw?.trim()) return null
  const cleaned = raw.replace(/\s+at\s+/i, ' ').replace(/\s+[A-Z]{3,4}$/, '')
  const d = new Date(cleaned)
  return isNaN(d.getTime()) ? null : d
}

main()
  .then(() => prisma.$disconnect())
  .catch(async err => {
    console.error('\n[import-plan] FAILED:', err)
    await prisma.$disconnect()
    process.exit(1)
  })
