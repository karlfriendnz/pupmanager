/**
 * Load a daycare plan — the day-parts and bookings `plan.json` cannot carry.
 *
 *   ./node_modules/.bin/dotenv -e .env.development.local -o -- \
 *     npx tsx scripts/import/import-daycare.ts \
 *       --env .env.development.local \
 *       --trainer dukes@pupmanager.dev \
 *       --daycare /tmp/dukes_daycare.json \
 *       [--dry-run]
 *
 * WHAT IT BUILDS
 * --------------
 * PupManager models a daycare as a group offering whose sessions are day-parts
 * (`Package.isPuppySchool`; see src/lib/run-kind.ts, where that flag is what
 * makes a run "daycare"). This writes exactly that shape:
 *
 *   Package(isPuppySchool)    the offering — "Dukes Daycare"
 *     └ PackageSessionSlot    one day-part: Tuesdays 07:00–18:00
 *     └ ClassRun              the cohort every booking is made against
 *         └ TrainingSession   one day-part on one date — a board cell
 *             └ ClassEnrollment (DROP_IN)   one dog booked into that day
 *                 └ SessionAttendance       ABSENT when they did not come
 *
 * A booking is a DROP_IN enrolment, not a FULL one, and that is the whole
 * point: `getPuppySchoolWeek` counts a FULL enrolee into every session of the
 * run, so a dog that comes on Tuesdays would appear on Wednesday, Thursday and
 * Friday as well. A drop-in counts only against the session it names.
 *
 * WHY IT IS A SEPARATE LOADER
 * ---------------------------
 * `import-client.ts` loads the canonical plan, whose vocabulary is people,
 * dogs, courses and consults. None of those is a day-part. Rather than widen
 * that schema for every client to serve one, this runs AFTER it and matches
 * into what it created — it creates no people and no dogs, and says so loudly
 * when it cannot find one.
 *
 * SAFETY
 * ------
 * Local sandbox only, checked here directly rather than through
 * assertWritableTarget (which the repo owner has widened to name a live host).
 * `--dry-run` does the entire load inside a transaction and rolls it back, so
 * the counts it reports are real. Re-runnable: everything is matched before it
 * is created, so a second run creates nothing.
 */
import { readFileSync } from 'fs'

import { scriptPrisma } from '../../src/lib/prisma-script'
import { zonedToUtc } from '../../src/lib/timezone'
import { arg, flag, heading, table } from './loader/cli'
import { describeUrl, isLocalSandbox, maskUrl } from './loader/guard'

const prisma = scriptPrisma()

type Slot = {
  key: string
  day: number
  startTime: string
  endTime: string
  label: string
  groups: string[]
  dates: string[]
  capacity: number | null
  priceCents: number | null
}
type Session = { slotKey: string; date: string; startTime: string; endTime: string; title: string }
type Booking = {
  date: string
  slotKey: string
  ownerEmail: string
  owner: string
  dog: string
  group: string
  bookingType: string
  attended: boolean
  extraDay: boolean
  endTime: string
  window: string
}
type DaycarePlan = {
  meta: { client: string; windows: string[]; counts: Record<string, number> }
  package: { name: string; capacity: number | null; priceCents: number | null }
  slots: Slot[]
  sessions: Session[]
  bookings: Booking[]
  needsReview: { kind: string; who: string; detail: string }[]
}

function requireLocalSandbox(): void {
  const url = process.env.DATABASE_URL ?? ''
  if (isLocalSandbox(url)) return
  const { host, database } = describeUrl(url)
  console.error('\n✋ Refusing to write: DATABASE_URL is not the local sandbox.')
  console.error(`   host     : ${host}`)
  console.error(`   database : ${database}`)
  console.error(`   url      : ${maskUrl(url)}`)
  console.error('\n   Run it through the dotenv wrapper, and keep the -o.\n')
  process.exit(1)
}

/** The env file the operator NAMED must be the database we actually hold. */
function assertEnvMatches(envPath: string): void {
  const declared = readFileSync(envPath, 'utf8')
    .split('\n')
    .find(l => l.trim().startsWith('DATABASE_URL='))
    ?.split('=')
    .slice(1)
    .join('=')
    .trim()
    .replace(/^["']|["']$/g, '')
  const actual = process.env.DATABASE_URL ?? ''
  if (!declared) return
  if (describeUrl(declared).database !== describeUrl(actual).database) {
    console.error(`\n✋ Connected to a different database from the one --env names.`)
    console.error(`   --env ${envPath} points at : ${describeUrl(declared).host} / ${describeUrl(declared).database}`)
    console.error(`   this process is connected to: ${describeUrl(actual).host} / ${describeUrl(actual).database}`)
    console.error('\n   The -o on the dotenv wrapper is what fixes this.\n')
    process.exit(1)
  }
}

/** "07:00" -> [7, 0] */
function hm(time: string): [number, number] {
  const [h, m] = time.split(':').map(Number)
  return [h || 0, m || 0]
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = hm(start)
  const [eh, em] = hm(end)
  const mins = eh * 60 + em - (sh * 60 + sm)
  // A day-part that appears to end before it starts has no readable end time;
  // an hour is a safer default than a negative duration, which would make the
  // session's occupied window run backwards.
  return mins > 0 ? mins : 60
}

function instant(date: string, time: string, tz: string): Date {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = hm(time)
  return zonedToUtc(y, mo, d, h, mi, tz)
}

async function run(dryRun: boolean, trainerEmail: string, plan: DaycarePlan) {
  const user = await prisma.user.findUnique({
    where: { email: trainerEmail },
    select: { timezone: true, trainerProfile: { select: { id: true } } },
  })
  const trainerId = user?.trainerProfile?.id
  if (!trainerId) {
    console.error(`\n✋ No trainer profile for ${trainerEmail}. Run create-trainer.ts first.\n`)
    process.exit(1)
  }
  const tz = user?.timezone ?? 'Pacific/Auckland'

  const stats = {
    packageCreated: 0, packageExisting: 0,
    runCreated: 0, runExisting: 0,
    slotsCreated: 0, slotsExisting: 0,
    sessionsCreated: 0, sessionsExisting: 0,
    enrolmentsCreated: 0, enrolmentsExisting: 0,
    absencesMarked: 0,
    clientsNotFound: 0, dogsNotFound: 0,
  }
  const problems: string[] = []

  await prisma.$transaction(async tx => {
    // ── the offering ──────────────────────────────────────────────────────
    let pkg = await tx.package.findFirst({
      where: { trainerId, name: plan.package.name, isPuppySchool: true },
      select: { id: true },
    })
    if (pkg) {
      stats.packageExisting++
    } else {
      pkg = await tx.package.create({
        data: {
          trainerId,
          name: plan.package.name,
          description: `Imported from ${plan.meta.client}'s DoggieDashboard reports.`,
          // isPuppySchool implies group + drop-in + ongoing (sessionCount 0);
          // the schema comment on the flag spells that out, so set all four
          // rather than leaving the others at their class-shaped defaults.
          isPuppySchool: true,
          isGroup: true,
          allowDropIn: true,
          sessionCount: 0,
          capacity: plan.package.capacity ?? undefined,
          priceCents: plan.package.priceCents ?? undefined,
        },
        select: { id: true },
      })
      stats.packageCreated++
    }

    // ── the cohort every booking hangs off ────────────────────────────────
    const firstDate = plan.sessions.map(s => s.date).sort()[0]
    let classRun = await tx.classRun.findFirst({
      where: { trainerId, packageId: pkg.id },
      select: { id: true },
    })
    if (classRun) {
      stats.runExisting++
    } else {
      classRun = await tx.classRun.create({
        data: {
          trainerId,
          packageId: pkg.id,
          name: plan.package.name,
          startDate: instant(firstDate, '00:00', tz),
          status: 'RUNNING',
          scheduleNote: plan.slots
            .map(s => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.day]} ${s.startTime}–${s.endTime}`)
            .join(', '),
        },
        select: { id: true },
      })
      stats.runCreated++
    }

    // ── day-parts ─────────────────────────────────────────────────────────
    const slotIdByKey = new Map<string, string>()
    for (const [i, slot] of plan.slots.entries()) {
      const existing = await tx.packageSessionSlot.findFirst({
        where: { packageId: pkg.id, day: slot.day, startTime: slot.startTime },
        select: { id: true },
      })
      if (existing) {
        slotIdByKey.set(slot.key, existing.id)
        stats.slotsExisting++
        continue
      }
      const created = await tx.packageSessionSlot.create({
        data: {
          packageId: pkg.id,
          order: i,
          day: slot.day,
          startTime: slot.startTime,
          endTime: slot.endTime || slot.startTime,
          startDate: slot.dates.length ? instant(slot.dates[0], slot.startTime, tz) : undefined,
          capacity: slot.capacity ?? undefined,
          priceCents: slot.priceCents ?? undefined,
          // Weekly: the reports show the same day-parts in both weeks.
          recurrenceRule: `FREQ=WEEKLY;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][slot.day]}`,
        },
        select: { id: true },
      })
      slotIdByKey.set(slot.key, created.id)
      stats.slotsCreated++
    }

    // ── one session per day-part per date ─────────────────────────────────
    const sessionIdByKey = new Map<string, string>()
    const slotByKey = new Map(plan.slots.map(s => [s.key, s]))
    for (const session of plan.sessions) {
      const slotId = slotIdByKey.get(session.slotKey)
      const slot = slotByKey.get(session.slotKey)
      if (!slotId || !slot) continue
      const scheduledAt = instant(session.date, session.startTime, tz)
      const existing = await tx.trainingSession.findFirst({
        where: { trainerId, classRunId: classRun.id, packageSessionSlotId: slotId, scheduledAt },
        select: { id: true },
      })
      const key = `${session.slotKey}|${session.date}`
      if (existing) {
        sessionIdByKey.set(key, existing.id)
        stats.sessionsExisting++
        continue
      }
      const created = await tx.trainingSession.create({
        data: {
          trainerId,
          classRunId: classRun.id,
          packageSessionSlotId: slotId,
          title: `${slot.label} — ${plan.package.name}`,
          scheduledAt,
          durationMins: minutesBetween(session.startTime, session.endTime || session.startTime),
          // These dates are in the past or the current week, and they happened.
          status: scheduledAt < new Date() ? 'COMPLETED' : 'UPCOMING',
        },
        select: { id: true },
      })
      sessionIdByKey.set(key, created.id)
      stats.sessionsCreated++
    }

    // ── the bookings ──────────────────────────────────────────────────────
    // Cached so 271 bookings across 109 owners do not become 271 lookups.
    const clientByEmail = new Map<string, { id: string; dogs: Map<string, string> } | null>()

    for (const booking of plan.bookings) {
      const sessionId = sessionIdByKey.get(`${booking.slotKey}|${booking.date}`)
      if (!sessionId) continue

      let client = clientByEmail.get(booking.ownerEmail)
      if (client === undefined) {
        const select = {
          id: true,
          dogId: true,
          dogs: { select: { id: true, name: true } },
          dog: { select: { id: true, name: true } },
        }
        let found = await tx.clientProfile.findFirst({
          where: { trainerId, user: { email: booking.ownerEmail } },
          select,
        })

        // An owner with no email address in the source got a placeholder minted
        // from their person id by the main import, and this step — working from
        // the reports, which have no id — mints a DIFFERENT one from their name.
        // The two never match, so every booking of every email-less client was
        // being dropped. Fall back to the name, but only when it is unambiguous:
        // two clients sharing a name is a question for a human, not a guess.
        if (!found && booking.ownerEmail.includes('@no-email.')) {
          const byName = await tx.clientProfile.findMany({
            where: { trainerId, user: { name: booking.owner.trim() } },
            select,
            take: 2,
          })
          if (byName.length === 1) {
            found = byName[0]
          } else if (byName.length > 1) {
            problems.push(`${booking.owner}: more than one client of that name — booking skipped, please link it by hand`)
          }
        }

        client = found
          ? {
              id: found.id,
              dogs: new Map(
                [...found.dogs, ...(found.dog ? [found.dog] : [])].map(d => [
                  d.name.trim().toLowerCase(),
                  d.id,
                ]),
              ),
            }
          : null
        clientByEmail.set(booking.ownerEmail, client)
      }
      if (!client) {
        stats.clientsNotFound++
        problems.push(`no client for ${booking.owner} <${booking.ownerEmail}> — run the main import first`)
        continue
      }

      const dogId = client.dogs.get(booking.dog.trim().toLowerCase()) ?? null
      if (!dogId) {
        stats.dogsNotFound++
        problems.push(`${booking.owner}: no dog called "${booking.dog}"`)
      }

      const existing = await tx.classEnrollment.findFirst({
        where: {
          classRunId: classRun.id,
          clientId: client.id,
          dogId,
          dropInSessionId: sessionId,
        },
        select: { id: true },
      })
      let enrolmentId = existing?.id
      if (enrolmentId) {
        stats.enrolmentsExisting++
      } else {
        const created = await tx.classEnrollment.create({
          data: {
            classRunId: classRun.id,
            clientId: client.id,
            dogId,
            type: 'DROP_IN',
            status: 'ENROLLED',
            dropInSessionId: sessionId,
            source: 'TRAINER',
          },
          select: { id: true },
        })
        enrolmentId = created.id
        stats.enrolmentsCreated++
      }

      // A booked dog that did not come is a booking plus an absence, so the
      // day still shows what was expected of it.
      if (!booking.attended && enrolmentId) {
        // NB the Prisma field is `enrollmentId` (two Ls, as in the schema) while
        // the local is `enrolmentId` — object shorthand does NOT work here.
        const mark = await tx.sessionAttendance.findUnique({
          where: { sessionId_enrollmentId: { sessionId, enrollmentId: enrolmentId } },
          select: { id: true },
        })
        if (!mark) {
          await tx.sessionAttendance.create({
            data: {
              sessionId,
              enrollmentId: enrolmentId,
              status: 'ABSENT',
              note: 'Marked "NOT HERE" in the DoggieDashboard weekly outlook.',
            },
          })
          stats.absencesMarked++
        }
      }
    }

    if (dryRun) {
      throw new DryRunRollback()
    }
  }, { timeout: 120_000, maxWait: 20_000 }).catch(e => {
    if (e instanceof DryRunRollback) return
    throw e
  })

  heading(dryRun ? 'Daycare — DRY RUN (rolled back)' : 'Daycare — imported')
  table(stats as unknown as Record<string, unknown>)
  if (problems.length) {
    console.log(`\n  ${problems.length} problem(s):`)
    for (const p of [...new Set(problems)].slice(0, 20)) console.log(`    · ${p}`)
    if (new Set(problems).size > 20) console.log(`    …and ${new Set(problems).size - 20} more`)
  }
  if (plan.needsReview.length) {
    console.log(`\n  ${plan.needsReview.length} note(s) from the extract step:`)
    for (const r of plan.needsReview) console.log(`    · ${r.kind}: ${r.who}`)
  }
  console.log()
}

class DryRunRollback extends Error {}

async function main() {
  requireLocalSandbox()
  const envPath = arg('env')
  if (envPath) assertEnvMatches(envPath)

  const trainerEmail = (arg('trainer') ?? '').trim().toLowerCase()
  const daycarePath = arg('daycare')
  const dryRun = flag('dry-run')

  if (!trainerEmail || !daycarePath) {
    console.error('\n✋ --trainer <email> and --daycare <daycare.json> are both required.\n')
    process.exit(1)
  }

  const plan: DaycarePlan = JSON.parse(readFileSync(daycarePath, 'utf8'))
  await run(dryRun, trainerEmail, plan)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
