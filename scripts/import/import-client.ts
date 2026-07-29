/**
 * The one command you run to import a client.
 *
 *   backup  →  dry run  →  report  →  STOP  →  (your approval)  →  apply  →  verify
 *
 * It stops. Every time. The approval is typed by a human at a terminal, into a
 * prompt that names the database — there is no flag, no environment variable and
 * no non-interactive path that reaches the apply step. A confirmation something
 * else can satisfy is not a confirmation, and the whole reason this script
 * exists is that the previous process had nothing between "here is a plan" and
 * "it is in the database".
 *
 *   ./node_modules/.bin/dotenv -e .env.development.local -o -- \
 *     npx tsx scripts/import/import-client.ts <client folder> \
 *       --env .env.development.local --trainer journey@pupmanager.dev
 *
 * The client folder is what the extract half produces: a plan.json (or
 * import_plan.json), optionally an extracted.json beside it.
 *
 * Flags:
 *   --reset          wipe this trainer's imported rows first (local sandbox only)
 *   --atomic         apply inside one transaction — all of it, or none of it
 *   --dry-run-only   stop after the report, never prompt
 *   --skip-backup    local sandbox only; refused anywhere else
 *   --out <dir>      where the backup goes (default ~/pupmanager-backups)
 *   --email-namespace <name>
 *                    salt for placeholder emails. Pin it per client and never
 *                    change it — changing it re-imports every email-less person
 *                    as a duplicate. (The Journey/Prime one-off used `prime`.)
 */
import { arg, flag, heading, positional, confirmExact } from './loader/cli'
import { loadPlan, planLabel, resolvePlanPath } from './loader/plan'
import { backupDatabase, printBackup, DEFAULT_BACKUP_DIR } from './backup'
import { dryRun, printDryRunReport } from './dry-run'
import { applyImport, printApplyReport } from './apply'
import { verify, printVerify } from './verify'
import { printTarget, resolveTarget } from './target'

async function main() {
  const folder = positional()
  if (!folder) {
    console.error('\nUsage: npx tsx scripts/import/import-client.ts <client folder> --env <env file> --trainer <email>\n')
    process.exit(1)
  }

  const target = await resolveTarget({ action: 'import a client' })
  const planPath = resolvePlanPath(folder)
  const plan = loadPlan(planPath)
  const label = planLabel(planPath, plan)

  heading(`IMPORT — ${label}`)
  printTarget(target)
  console.log(`\n  plan   : ${planPath}`)
  console.log(`  reset  : ${flag('reset') ? "YES — this trainer's imported rows are deleted first" : 'no'}`)
  console.log(`  atomic : ${flag('atomic') ? 'yes' : 'no'}`)

  // ── 1. Backup ──────────────────────────────────────────────────────────────
  if (flag('skip-backup')) {
    if (!target.isLocal) {
      console.error('\n✋ --skip-backup is only allowed against the local sandbox.\n')
      process.exit(1)
    }
    console.log('\n  backup : SKIPPED (--skip-backup, local sandbox)')
  } else {
    console.log('\nTaking a backup before anything else …')
    const backup = await backupDatabase(target, arg('out') ?? DEFAULT_BACKUP_DIR)
    printBackup(backup, target)
  }

  // ── 2. Dry run ─────────────────────────────────────────────────────────────
  console.log('Running the whole import inside a transaction, then rolling it back …')
  const report = await dryRun(target, planPath, {
    reset: flag('reset'),
    extractedPath: arg('extracted') ?? null,
    emailNamespace: arg('email-namespace') ?? null,
  })
  printDryRunReport(report)

  if (!report.rolledBackCleanly) {
    console.error('✋ The dry run did not roll back cleanly. Stopping — do not apply.\n')
    process.exit(1)
  }

  // ── 3. Stop ────────────────────────────────────────────────────────────────
  if (flag('dry-run-only')) {
    console.log('Stopped after the dry run (--dry-run-only). Nothing was written.\n')
    return
  }
  if (!process.stdin.isTTY) {
    console.log('Stopped after the dry run: applying needs a typed approval at a terminal,')
    console.log('and this is not one. Nothing was written.\n')
    return
  }

  heading('APPROVAL REQUIRED')
  const s = report.result.stats
  console.log(`  This will create ${s.clientsCreated} client(s), ${s.dogsCreated} dog(s), ${s.classRunsCreated} class(es),`)
  console.log(`  ${s.enrolmentsCreated} enrolment(s) and ${s.subscribersCreated} subscriber(s),`)
  console.log(`  and merge ${s.clientsMerged} existing client(s), in ${target.database} on ${target.host}.`)
  if (flag('reset') && report.reset) {
    console.log(`\n  It will FIRST DELETE ${report.reset.profiles} client(s) and ${report.reset.classRuns} class(es) from this trainer.`)
  }
  console.log('\n  Nothing has been written yet. Press Ctrl-C to walk away.')
  await confirmExact(`\n  Type the database name to apply (${target.database}): `, target.database)

  // ── 4. Apply ───────────────────────────────────────────────────────────────
  console.log('\nApplying …')
  const applied = await applyImport(target, planPath, {
    reset: flag('reset'),
    atomic: flag('atomic'),
    extractedPath: arg('extracted') ?? null,
    emailNamespace: arg('email-namespace') ?? null,
  })
  printApplyReport(applied)

  // ── 5. Verify ──────────────────────────────────────────────────────────────
  const { rows, ok } = await verify(target, planPath, arg('email-namespace') ?? null)
  printVerify(rows, ok, label)
  if (!ok) process.exit(1)
}

main().catch(err => {
  console.error('\n[import-client] FAILED:', err?.message ?? err, '\n')
  process.exit(1)
})
