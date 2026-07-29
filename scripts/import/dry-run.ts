/**
 * A REAL dry run: the entire import, executed against the target database
 * inside one interactive transaction, then rolled back.
 *
 * Not a simulation. Every insert, update, unique constraint, foreign key and
 * merge decision is the one the real import would make — so the counts it
 * reports are exact, and a plan that would fail fails here instead of halfway
 * through a live load. The only difference is the ROLLBACK at the end.
 *
 * Why this is the missing capability: until now the only way to find out what an
 * import would do was to do it, and then decide whether to keep it.
 *
 *   ./node_modules/.bin/dotenv -e .env.development.local -o -- \
 *     npx tsx scripts/import/dry-run.ts \
 *       --env .env.development.local --trainer journey@pupmanager.dev \
 *       --plan /path/to/plan.json [--reset] [--json /path/to/report.json]
 *
 * --reset previews a wipe-and-reload (the delete happens inside the transaction
 * and is rolled back with everything else).
 */
import { writeFileSync } from 'fs'
import { scriptPrisma } from '../../src/lib/prisma-script'
import { arg, flag, heading, table } from './loader/cli'
import { runImport } from './loader/engine'
import {
  loadPlan, planLabel, planTotals, resolveEmailNamespace, resolveExtractPath, resolvePlanPath,
} from './loader/plan'
import { resetTrainer, type ResetCounts } from './loader/reset'
import type { Db, ImportResult } from './loader/types'
import { printTarget, resolveTarget, type Target } from './target'

/** 30 minutes: a big plan is thousands of statements and must not be cut off mid-run. */
const TX_TIMEOUT_MS = 30 * 60_000
const TX_MAX_WAIT_MS = 60_000

export interface Snapshot {
  clients: number
  dogs: number
  packages: number
  classRuns: number
  sessions: number
  enrolments: number
  clientPackages: number
  subscribers: number
  customFieldValues: number
  /** Whole-database totals, to prove the rollback reached beyond this tenant too. */
  allUsers: number
  allDogs: number
  allClientProfiles: number
}

export async function snapshot(db: Db, trainerId: string): Promise<Snapshot> {
  const [
    clients, dogs, packages, classRuns, sessions, enrolments, clientPackages, subscribers,
    customFieldValues, allUsers, allDogs, allClientProfiles,
  ] = await Promise.all([
    db.clientProfile.count({ where: { trainerId } }),
    db.dog.count({
      where: { OR: [{ owner: { trainerId } }, { primaryFor: { some: { trainerId } } }] },
    }),
    db.package.count({ where: { trainerId } }),
    db.classRun.count({ where: { trainerId } }),
    db.trainingSession.count({ where: { trainerId } }),
    db.classEnrollment.count({ where: { classRun: { trainerId } } }),
    db.clientPackage.count({ where: { package: { trainerId } } }),
    db.subscriber.count({ where: { trainerId } }),
    db.customFieldValue.count({ where: { client: { trainerId } } }),
    db.user.count(),
    db.dog.count(),
    db.clientProfile.count(),
  ])
  return {
    clients, dogs, packages, classRuns, sessions, enrolments, clientPackages, subscribers,
    customFieldValues, allUsers, allDogs, allClientProfiles,
  }
}

export interface DryRunReport {
  ranAt: string
  target: Pick<Target, 'host' | 'database' | 'trainerEmail' | 'businessName' | 'trainerId'>
  planPath: string
  planLabel: string
  emailNamespace: string
  planTotals: ReturnType<typeof planTotals>
  reset: ResetCounts | null
  before: Snapshot
  wouldBe: Snapshot
  delta: Record<string, number>
  after: Snapshot
  rolledBackCleanly: boolean
  result: ImportResult
  elapsedMs: number
}

class Rollback extends Error {
  constructor(public payload: { result: ImportResult; wouldBe: Snapshot; reset: ResetCounts | null }) {
    super('dry-run rollback')
  }
}

export async function dryRun(
  target: Target,
  planPath: string,
  opts: {
    reset?: boolean
    extractedPath?: string | null
    emailNamespace?: string | null
    quiet?: boolean
  } = {},
): Promise<DryRunReport> {
  const plan = loadPlan(planPath)
  const extractedPath = resolveExtractPath(planPath, opts.extractedPath)
  const totals = planTotals(plan)
  const emailNamespace = resolveEmailNamespace(plan, opts.emailNamespace)
  const prisma = scriptPrisma()
  const started = Date.now()

  try {
    const before = await snapshot(prisma, target.trainerId)

    let payload: { result: ImportResult; wouldBe: Snapshot; reset: ResetCounts | null } | null = null
    try {
      await prisma.$transaction(
        async tx => {
          const resetCounts = opts.reset ? await resetTrainer(tx, target.trainerId) : null
          const result = await runImport(tx, {
            trainerId: target.trainerId,
            plan,
            extractedPath,
            emailNamespace,
            // Inside a transaction one failed statement poisons the rest, so each
            // person gets a savepoint — a single bad row is reported without
            // taking the other 684 down with it.
            savepoints: true,
            onProgress: opts.quiet
              ? undefined
              : (label, done, total) => process.stdout.write(`\r  ${label}: ${done}/${total}   `),
          })
          const wouldBe = await snapshot(tx, target.trainerId)
          // Everything above is real. This is the only thing that makes it a dry run.
          throw new Rollback({ result, wouldBe, reset: resetCounts })
        },
        { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS },
      )
    } catch (err) {
      if (err instanceof Rollback) payload = err.payload
      else throw err
    }
    if (!opts.quiet) process.stdout.write('\r'.padEnd(60) + '\r')
    if (!payload) throw new Error('Dry run did not reach the rollback — nothing to report.')

    const after = await snapshot(prisma, target.trainerId)
    const delta: Record<string, number> = {}
    for (const k of Object.keys(payload.wouldBe) as (keyof Snapshot)[]) {
      delta[k] = payload.wouldBe[k] - before[k]
    }
    const rolledBackCleanly = (Object.keys(before) as (keyof Snapshot)[]).every(k => before[k] === after[k])

    return {
      ranAt: new Date().toISOString(),
      target: {
        host: target.host, database: target.database, trainerEmail: target.trainerEmail,
        businessName: target.businessName, trainerId: target.trainerId,
      },
      planPath,
      planLabel: planLabel(planPath, plan),
      emailNamespace,
      planTotals: totals,
      reset: payload.reset,
      before,
      wouldBe: payload.wouldBe,
      delta,
      after,
      rolledBackCleanly,
      result: payload.result,
      elapsedMs: Date.now() - started,
    }
  } finally {
    await prisma.$disconnect()
  }
}

export function printDryRunReport(r: DryRunReport): void {
  heading(`DRY RUN — ${r.planLabel}  (nothing was written)`)
  table({
    plan: r.planPath,
    target: `${r.target.businessName} <${r.target.trainerEmail}>`,
    database: `${r.target.database} on ${r.target.host}`,
    'email namespace': r.emailNamespace,
    took: `${(r.elapsedMs / 1000).toFixed(1)}s`,
  })

  if (r.reset) {
    heading('WOULD DELETE FIRST (--reset)')
    table(r.reset as unknown as Record<string, unknown>)
  }

  heading('WHAT THE PLAN CONTAINS')
  const t = r.planTotals
  table({
    people: `${t.people}  (${t.peopleWithEmail} with an email, ${t.peoplePlaceholderEmail} without)`,
    dogs: `${t.dogs}  (${t.dogsDeceased} deceased)`,
    courses: `${t.courses}  (${t.coursesSpreadsheet} from the spreadsheet, ${t.coursesReconstructed} reconstructed)`,
    enrolments: t.enrolments,
    '1:1 consults': `${t.oneToOneConsults}  across ${t.distinctConsultServices} service(s)`,
    subscribers: t.subscribers,
    'custom field values': t.customFieldValues,
  })

  heading('WHAT IT WOULD DO — created vs merged')
  const s = r.result.stats
  table({
    'clients created': s.clientsCreated,
    'clients merged (blanks backfilled / notes appended)': s.clientsMerged,
    'clients already complete (no change)': s.clientsExisting,
    'clients that FAILED': s.peopleFailed,
    '': '',
    'dogs created': `${s.dogsCreated}  (${s.dogsDeceased} deceased, ${s.dogsUnnamed} unnamed)`,
    'dogs already present (deduped by name)': s.dogsExisting,
    ' ': '',
    'classes created (package + run + sessions)': `${s.classRunsCreated} runs, ${s.sessionsCreated} sessions`,
    'classes reused (name already exists)': s.coursesExisting,
    '  ': '',
    'enrolments created': s.enrolmentsCreated,
    'enrolments already present': s.enrolmentsExisting,
    'enrolments unmatched / failed': s.enrolmentsUnmatched,
    '   ': '',
    '1:1 packages created': s.consultPackagesCreated,
    'client packages created': s.clientPackagesCreated,
    'client packages already present': s.clientPackagesExisting,
    '    ': '',
    'subscribers created': s.subscribersCreated,
    'subscribers already present': s.subscribersExisting,
    '     ': '',
    'custom field values written': s.customFieldValues,
    'custom field values updated': s.customFieldValuesUpdated,
    'placeholder emails minted': s.placeholderEmails,
  })

  if (r.result.collisions.length) {
    heading(`CLASS NAME COLLISIONS — ${r.result.collisions.length} course(s) reuse an existing class run`)
    console.log('  These are NOT duplicated. The plan course maps onto the class that is already there,')
    console.log('  and its enrolments are added to it. If that is wrong, rename one side first.\n')
    for (const c of r.result.collisions.slice(0, 25)) {
      console.log(`  · ${c.name}${c.origin === 'invented' ? '  (reconstructed)' : ''}`)
    }
    if (r.result.collisions.length > 25) console.log(`  … and ${r.result.collisions.length - 25} more`)
  }

  const missing = Object.entries(r.result.missingCustomFields)
  if (missing.length) {
    heading(`CUSTOM FIELDS THAT DO NOT EXIST ON THIS TRAINER — ${missing.length}`)
    console.log('  Values for these are DROPPED. Create the fields on the trainer first if you want them.\n')
    for (const [label, count] of missing.sort((a, b) => b[1] - a[1])) {
      console.log(`  · ${label}  — ${count} value(s) would be lost`)
    }
  }

  heading('NET EFFECT ON THE DATABASE')
  const rows: Record<string, unknown> = {}
  for (const k of Object.keys(r.before) as (keyof Snapshot)[]) {
    const d = r.delta[k]
    rows[k] = `${r.before[k]}  →  ${r.wouldBe[k]}   ${d > 0 ? `(+${d})` : d < 0 ? `(${d})` : '(unchanged)'}`
  }
  table(rows)

  heading('ROLLBACK')
  if (r.rolledBackCleanly) {
    console.log('  ✓ Every count is back where it started. Nothing was written.\n')
  } else {
    console.log('  ✋ COUNTS DIFFER AFTER ROLLBACK — the transaction did not fully revert.')
    for (const k of Object.keys(r.before) as (keyof Snapshot)[]) {
      if (r.before[k] !== r.after[k]) console.log(`     ${k}: before=${r.before[k]} after=${r.after[k]}`)
    }
    console.log('')
  }

  if (r.result.problems.length) {
    heading(`PROBLEMS — ${r.result.problems.length}`)
    for (const line of r.result.problems.slice(0, 40)) console.log(`  · ${line}`)
    if (r.result.problems.length > 40) console.log(`  … and ${r.result.problems.length - 40} more`)
    console.log('')
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
async function main() {
  const target = await resolveTarget({ action: 'dry-run (opens a write transaction, then rolls it back)' })
  printTarget(target)

  const planArg = arg('plan')
  if (!planArg) {
    console.error('\n✋ --plan <path to plan.json or a client folder> is required.\n')
    process.exit(1)
  }
  const planPath = resolvePlanPath(planArg)

  console.log(`\nRunning the full import inside a transaction, then rolling it back …`)
  const report = await dryRun(target, planPath, {
    reset: flag('reset'),
    extractedPath: arg('extracted') ?? null,
    emailNamespace: arg('email-namespace') ?? null,
  })
  printDryRunReport(report)

  const jsonOut = arg('json')
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(report, null, 2))
    console.log(`Report written to ${jsonOut}\n`)
  }

  if (!report.rolledBackCleanly) process.exit(1)
}

if (process.argv[1] && process.argv[1].endsWith('dry-run.ts')) {
  main().catch(err => {
    console.error('\n[dry-run] FAILED:', err)
    process.exit(1)
  })
}
