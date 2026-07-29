/**
 * The real load. Same loader the dry run exercises, without the rollback.
 *
 * Generalised from scripts/prime/import-plan.ts: no hardcoded trainer, no
 * hardcoded plan path, no hardcoded client. The merge semantics are byte-for-
 * byte the ones that one-off proved out — existing records are never
 * overwritten, blanks are backfilled, notes are appended, dogs are deduped by
 * name, courses are reused by name — so re-running creates nothing new.
 *
 *   ./node_modules/.bin/dotenv -e .env.development.local -o -- \
 *     npx tsx scripts/import/apply.ts \
 *       --env .env.development.local --trainer journey@pupmanager.dev \
 *       --plan /path/to/plan.json [--reset] [--atomic]
 *
 * Prefer scripts/import/import-client.ts, which takes a backup and shows you the
 * dry run first. Reach for apply.ts directly only when you have already done both.
 *
 * --reset wipes this trainer's imported rows first and is refused against
 * anything but the local sandbox, regardless of what the write guard allows.
 * --atomic wraps the whole load in one transaction: all of it lands or none of
 * it does. Off by default, because without it a failure part-way through leaves
 * real progress that a re-run picks up rather than an all-or-nothing retry.
 */
import { scriptPrisma } from '../../src/lib/prisma-script'
import { arg, flag, heading, table } from './loader/cli'
import { runImport } from './loader/engine'
import {
  loadPlan, planLabel, resolveEmailNamespace, resolveExtractPath, resolvePlanPath,
} from './loader/plan'
import { resetTrainer, type ResetCounts } from './loader/reset'
import type { Db, ImportResult } from './loader/types'
import { snapshot, type Snapshot } from './dry-run'
import { confirmTarget, printTarget, resolveTarget, type Target } from './target'

const TX_TIMEOUT_MS = 30 * 60_000
const TX_MAX_WAIT_MS = 60_000

export interface ApplyReport {
  ranAt: string
  planPath: string
  planLabel: string
  reset: ResetCounts | null
  before: Snapshot
  after: Snapshot
  delta: Record<string, number>
  result: ImportResult
  elapsedMs: number
}

export async function applyImport(
  target: Target,
  planPath: string,
  opts: {
    reset?: boolean
    atomic?: boolean
    extractedPath?: string | null
    emailNamespace?: string | null
    quiet?: boolean
  } = {},
): Promise<ApplyReport> {
  if (opts.reset && !target.isLocal) {
    throw new Error('--reset deletes existing records and is only ever allowed against the local sandbox.')
  }

  const plan = loadPlan(planPath)
  const extractedPath = resolveExtractPath(planPath, opts.extractedPath)
  const emailNamespace = resolveEmailNamespace(plan, opts.emailNamespace)
  const prisma = scriptPrisma()
  const started = Date.now()

  try {
    const before = await snapshot(prisma, target.trainerId)

    const onProgress = opts.quiet
      ? undefined
      : (label: string, done: number, total: number) => process.stdout.write(`\r  ${label}: ${done}/${total}   `)

    const load = async (db: Db, savepoints: boolean) => {
      const resetCounts = opts.reset ? await resetTrainer(db, target.trainerId) : null
      const result = await runImport(db, {
        trainerId: target.trainerId,
        plan,
        extractedPath,
        emailNamespace,
        savepoints,
        onProgress,
      })
      return { resetCounts, result }
    }

    const { resetCounts, result } = opts.atomic
      ? await prisma.$transaction(tx => load(tx, true), { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS })
      : await load(prisma, false)

    if (!opts.quiet) process.stdout.write('\r'.padEnd(60) + '\r')

    const after = await snapshot(prisma, target.trainerId)
    const delta: Record<string, number> = {}
    for (const k of Object.keys(after) as (keyof Snapshot)[]) delta[k] = after[k] - before[k]

    return {
      ranAt: new Date().toISOString(),
      planPath,
      planLabel: planLabel(planPath, plan),
      reset: resetCounts,
      before,
      after,
      delta,
      result,
      elapsedMs: Date.now() - started,
    }
  } finally {
    await prisma.$disconnect()
  }
}

export function printApplyReport(r: ApplyReport): void {
  heading(`IMPORT COMPLETE — ${r.planLabel}`)
  if (r.reset) {
    console.log('  Reset first:')
    table(r.reset as unknown as Record<string, unknown>)
    console.log('')
  }
  table(r.result.stats as unknown as Record<string, unknown>)

  heading('DATABASE BEFORE → AFTER')
  const rows: Record<string, unknown> = {}
  for (const k of Object.keys(r.after) as (keyof Snapshot)[]) {
    const d = r.delta[k]
    rows[k] = `${r.before[k]}  →  ${r.after[k]}   ${d > 0 ? `(+${d})` : d < 0 ? `(${d})` : '(unchanged)'}`
  }
  table(rows)
  console.log(`\n  took ${(r.elapsedMs / 1000).toFixed(1)}s`)

  if (r.result.problems.length) {
    heading(`PROBLEMS — ${r.result.problems.length}`)
    for (const line of r.result.problems.slice(0, 40)) console.log(`  · ${line}`)
    if (r.result.problems.length > 40) console.log(`  … and ${r.result.problems.length - 40} more`)
  }
  console.log('')
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
async function main() {
  const target = await resolveTarget({ action: 'apply an import' })
  printTarget(target, 'APPLY — THIS WILL WRITE')

  const planArg = arg('plan')
  if (!planArg) {
    console.error('\n✋ --plan <path to plan.json or a client folder> is required.\n')
    process.exit(1)
  }
  const planPath = resolvePlanPath(planArg)
  const reset = flag('reset')

  console.log(`\n  plan  : ${planPath}`)
  console.log(`  reset : ${reset ? 'YES — this trainer\'s imported rows are deleted first' : 'no'}`)
  console.log(`  atomic: ${flag('atomic') ? 'yes — one transaction, all or nothing' : 'no'}`)
  console.log('\n  Have you run dry-run.ts and taken a backup? apply.ts does neither.')

  await confirmTarget(target, `write this plan into ${target.businessName}`)

  const report = await applyImport(target, planPath, {
    reset,
    atomic: flag('atomic'),
    extractedPath: arg('extracted') ?? null,
    emailNamespace: arg('email-namespace') ?? null,
  })
  printApplyReport(report)
  console.log('  Next: verify.ts, to check the database against the plan independently.\n')
}

if (process.argv[1] && process.argv[1].endsWith('apply.ts')) {
  main().catch(err => {
    console.error('\n[apply] FAILED:', err)
    process.exit(1)
  })
}
