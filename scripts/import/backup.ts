/**
 * Dump the target database to a timestamped file before anything is written.
 *
 * Refuses to report success unless the dump actually completed: a non-zero exit,
 * an empty file, or a dump missing pg_dump's own completion marker all fail
 * loudly. A backup you have not checked is not a backup, and the whole point of
 * taking one is that the next step is irreversible.
 *
 * pg_dump rejects a connection string carrying Prisma's `?schema=` (and friends)
 * — libpq does not know those parameters — so they are stripped before it runs.
 *
 *   ./node_modules/.bin/dotenv -e .env.development.local -o -- \
 *     npx tsx scripts/import/backup.ts \
 *       --env .env.development.local --trainer journey@pupmanager.dev [--out <dir>]
 *
 * Backups default to ~/pupmanager-backups/ — deliberately OUTSIDE the repo, so a
 * dump full of client data can never be committed by accident.
 */
import { spawn, spawnSync } from 'child_process'

/**
 * Which pg_dump to run. Overridable because pg_dump refuses to dump a server
 * NEWER than itself, and Homebrew's default is routinely a major version behind
 * a managed Postgres (Supabase was on 17.6 against a local 16.14). Point it at a
 * matching build rather than skipping the backup:
 *
 *   PG_DUMP=/opt/homebrew/opt/postgresql@17/bin/pg_dump
 */
const PG_DUMP = process.env.PG_DUMP ?? 'pg_dump'

/**
 * Extra pg_dump arguments, space-separated. Opt-in and passed on the command
 * line rather than baked in, so what a given backup covers is visible in shell
 * history instead of being quietly narrowed by a default.
 *
 * The case this exists for: a managed Postgres carries schemas that are the
 * PLATFORM's, not the application's, and one of them can break the dump.
 * Supabase's pg_cron keeps every scheduled-job run in cron.job_run_details,
 * which grows without bound and dropped the SSL connection mid-COPY:
 *
 *   PG_DUMP_EXTRA_ARGS=--exclude-schema=cron
 *
 * That is a safe exclusion — a run log is not application data and restoring
 * one would be meaningless. Excluding anything under `public` is not: that is
 * where every client record lives.
 */
const PG_DUMP_EXTRA_ARGS = (process.env.PG_DUMP_EXTRA_ARGS ?? '')
  .split(' ')
  .map(s => s.trim())
  .filter(Boolean)
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { arg, heading, table } from './loader/cli'
import { describeUrl } from './loader/guard'
import { resolveTarget, type Target } from './target'

export const DEFAULT_BACKUP_DIR = join(homedir(), 'pupmanager-backups')

/**
 * Prisma-only connection parameters. libpq (and therefore pg_dump) errors on
 * them — `invalid URI query parameter: "schema"` — so they come out.
 */
const PRISMA_ONLY_PARAMS = new Set([
  'schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'socket_timeout', 'statement_cache_size',
])

export function pgDumpUrl(url: string): string {
  const q = url.indexOf('?')
  if (q < 0) return url
  const base = url.slice(0, q)
  const kept = url
    .slice(q + 1)
    .split('&')
    .filter(Boolean)
    .filter(pair => !PRISMA_ONLY_PARAMS.has(decodeURIComponent(pair.split('=')[0])))
  return kept.length ? `${base}?${kept.join('&')}` : base
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'target'
}

/** LOCAL time, so the filename matches what `ls` shows and files sort as expected. */
function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

export interface BackupResult {
  path: string
  bytes: number
  elapsedMs: number
}

/**
 * Take the dump. Throws on any doubt — callers treat a throw as "do not proceed".
 */
export async function backupDatabase(
  target: Pick<Target, 'databaseUrl' | 'database' | 'businessName'>,
  outDir = DEFAULT_BACKUP_DIR,
): Promise<BackupResult> {
  const probe = spawnSync(PG_DUMP, ['--version'], { encoding: 'utf-8' })
  if (probe.error || probe.status !== 0) {
    throw new Error(
      `${PG_DUMP} is not available — cannot take a backup, so the import must not proceed.\n` +
      '   Install the Postgres client tools (macOS: `brew install libpq` then add it to PATH).',
    )
  }

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const path = join(outDir, `${slug(target.database)}--${slug(target.businessName)}--${timestamp()}.sql`)

  const started = Date.now()
  const url = pgDumpUrl(target.databaseUrl)
  const stderr: string[] = []

  const out = createWriteStream(path)
  // --no-owner / --no-acl keep the dump restorable into a different role, which
  // is what a restore under pressure usually needs.
  const child = spawn(
    PG_DUMP,
    ['--no-owner', '--no-acl', '--format=plain', ...PG_DUMP_EXTRA_ARGS, url],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stderr.on('data', d => stderr.push(String(d)))

  // Both listeners are attached BEFORE anything can fire. pipe() ends the write
  // stream itself, so a 'finish' handler registered later (e.g. inside the
  // child's 'close' callback) can miss the event entirely — leaving the promise
  // unsettled, the process exiting 0, and an unchecked dump reported as fine.
  const written = new Promise<void>((resolve, reject) => {
    out.on('finish', () => resolve())
    out.on('error', reject)
  })
  const exited = new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => resolve(code ?? -1))
  })
  child.stdout.pipe(out)

  const [code] = await Promise.all([exited, written])
  if (code !== 0) {
    throw new Error(`pg_dump exited ${code}:\n${stderr.join('').trim() || '(no output)'}`)
  }

  const bytes = statSync(path).size
  if (bytes === 0) throw new Error(`pg_dump wrote an empty file: ${path}`)

  // pg_dump ends every complete plain dump with this line. Its absence means the
  // dump was truncated even though the exit code looked fine.
  const tail = readFileSync(path, 'utf-8').slice(-4000)
  if (!tail.includes('PostgreSQL database dump complete')) {
    throw new Error(
      `Dump is missing pg_dump's completion marker — treating it as truncated: ${path}\n` +
      (stderr.join('').trim() || ''),
    )
  }

  return { path, bytes, elapsedMs: Date.now() - started }
}

export function printBackup(result: BackupResult, target: Pick<Target, 'database' | 'host'>): void {
  heading('BACKUP TAKEN')
  table({
    database: `${target.database} on ${target.host}`,
    file: result.path,
    size: `${(result.bytes / 1024 / 1024).toFixed(2)} MB`,
    took: `${(result.elapsedMs / 1000).toFixed(1)}s`,
    restore: `psql "<connection>" < ${result.path}`,
  })
  console.log('')
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
async function main() {
  // Read-only as far as the database is concerned, but a backup is only ever
  // taken because a write is coming, so the target is resolved the same way.
  const target = await resolveTarget({ readOnly: true })
  const { host, database } = describeUrl(target.databaseUrl)
  console.log(`\nDumping ${database} on ${host} …`)
  if (PG_DUMP_EXTRA_ARGS.length) {
    console.log(`  extra pg_dump args: ${PG_DUMP_EXTRA_ARGS.join(' ')}`)
  }
  const result = await backupDatabase(target, arg('out') ?? DEFAULT_BACKUP_DIR)
  printBackup(result, target)
}

if (process.argv[1] && process.argv[1].endsWith('backup.ts')) {
  main().catch(err => {
    console.error('\n[backup] FAILED — do not proceed with the import:\n  ', err.message ?? err, '\n')
    process.exit(1)
  })
}
