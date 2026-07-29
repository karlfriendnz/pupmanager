/**
 * WHERE an import is going — resolved from explicit arguments, never from a
 * constant baked into a script.
 *
 * A target is (a connection, a trainer). Both must be stated on the command
 * line, and both are echoed back with enough detail to recognise the wrong one
 * before anything is written:
 *
 *   host · database · business name · current client count
 *
 * The `--env` argument is CHECKED, not decorative. The script reads the env file
 * you name, pulls its DATABASE_URL, and refuses if that is not the connection
 * the process actually has. That catches the exact accident this toolkit exists
 * to prevent: DATABASE_URL is exported in the ambient shell pointing at a remote
 * database, so a dotenv wrapper without -o silently leaves you connected to the
 * wrong one while the command line reads as though you are local.
 *
 * Usage (read-only — prints the target and exits):
 *
 *   ./node_modules/.bin/dotenv -e .env.development.local -o -- \
 *     npx tsx scripts/import/target.ts \
 *       --env .env.development.local --trainer journey@pupmanager.dev
 */
import { existsSync, readFileSync } from 'fs'
import { scriptPrisma } from '../../src/lib/prisma-script'
import { arg, confirmExact, heading, table } from './loader/cli'
import { assertWritableTarget, describeUrl, isLocalSandbox, maskUrl } from './loader/guard'

export interface Target {
  /** The env file the caller declared, e.g. `.env.development.local`. */
  envFile: string
  /** Trainer owner's login email. */
  trainerEmail: string
  trainerId: string
  businessName: string
  clientCount: number
  host: string
  database: string
  databaseUrl: string
  isLocal: boolean
}

/** Pull DATABASE_URL out of a .env file without executing or exporting anything. */
function databaseUrlFromEnvFile(path: string): string | null {
  if (!existsSync(path)) return null
  for (const raw of readFileSync(path, 'utf-8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/)
    if (!m) continue
    return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

/**
 * Confirm the process is connected to the env file the caller named.
 *
 * A mismatch is always fatal: either the wrapper is missing its -o, or the
 * command line is describing a different database from the one it will hit.
 * Both are the same bug wearing different clothes.
 */
function assertEnvFileMatches(envFile: string, actual: string): void {
  const declared = databaseUrlFromEnvFile(envFile)
  if (declared == null) {
    console.error(`\n✋ ${envFile} does not exist, or sets no DATABASE_URL.`)
    console.error('   --env must name the env file this command was wrapped with.\n')
    process.exit(1)
  }
  if (declared !== actual) {
    const d = describeUrl(declared)
    const a = describeUrl(actual)
    console.error(`\n✋ Connected to a different database from the one --env names.`)
    console.error(`   --env ${envFile} points at : ${d.host} / ${d.database}`)
    console.error(`   this process is connected to: ${a.host} / ${a.database}`)
    console.error(`   (${maskUrl(actual)})`)
    console.error('\n   Almost always a missing -o on the dotenv wrapper: DATABASE_URL is')
    console.error('   exported in the ambient shell and wins unless dotenv is told to override.')
    console.error(`     ./node_modules/.bin/dotenv -e ${envFile} -o -- npx tsx <script>\n`)
    process.exit(1)
  }
}

export interface ResolveOptions {
  /** What the caller intends to do — used in refusal messages only. */
  action?: string
  /** Skip the write guard (verify.ts and target.ts itself only read). */
  readOnly?: boolean
}

/**
 * Resolve + validate a target. Every script starts here.
 *
 * Throws/exits rather than returning a half-valid target: there is no useful
 * "carry on anyway" for a target that cannot be identified.
 */
export async function resolveTarget(opts: ResolveOptions = {}): Promise<Target> {
  const envFile = arg('env')
  const trainerEmail = arg('trainer')

  if (!envFile || !trainerEmail) {
    console.error('\nUsage: --env <env file> --trainer <owner email>')
    console.error('   e.g. --env .env.development.local --trainer journey@pupmanager.dev')
    console.error('\nBoth are required. Neither has a default — an import target should never')
    console.error('be something a script assumed.\n')
    process.exit(1)
  }

  const url = process.env.DATABASE_URL ?? ''
  if (!url) {
    console.error('\n✋ No DATABASE_URL. Run through the dotenv wrapper:')
    console.error(`   ./node_modules/.bin/dotenv -e ${envFile} -o -- npx tsx <script>\n`)
    process.exit(1)
  }
  assertEnvFileMatches(envFile, url)
  if (!opts.readOnly) assertWritableTarget(url, opts.action ?? 'write')

  const { host, database } = describeUrl(url)
  const prisma = scriptPrisma()
  try {
    const user = await prisma.user.findUnique({
      where: { email: trainerEmail },
      select: {
        trainerProfile: {
          select: { id: true, businessName: true, _count: { select: { clients: true } } },
        },
      },
    })
    const profile = user?.trainerProfile
    if (!profile) {
      console.error(`\n✋ No trainer profile for ${trainerEmail} in ${database} on ${host}.`)
      console.error('   Check the email, and check you are pointed at the right database.\n')
      process.exit(1)
    }
    return {
      envFile,
      trainerEmail,
      trainerId: profile.id,
      businessName: profile.businessName,
      clientCount: profile._count.clients,
      host,
      database,
      databaseUrl: url,
      isLocal: isLocalSandbox(url),
    }
  } finally {
    await prisma.$disconnect()
  }
}

export function printTarget(t: Target, title = 'IMPORT TARGET'): void {
  heading(title)
  table({
    'env file': t.envFile,
    host: t.host,
    database: t.database,
    'local sandbox': t.isLocal ? 'yes' : 'NO — writes are refused',
    trainer: `${t.businessName} <${t.trainerEmail}>`,
    'trainer id': t.trainerId,
    'clients today': t.clientCount,
  })
}

/**
 * Make the operator prove they have read the target before anything is written.
 * They must type the database name — a y/n cannot distinguish "yes, that one"
 * from "yes, whatever it said".
 *
 * The LOCAL SANDBOX is exempt. The prompt exists to stop someone writing to a
 * real customer's database by accident; pupmanager_dev is disposable, is the
 * only target the guard permits by default, and can be rebuilt by re-running the
 * import. Demanding a keystroke there buys no safety and blocks the import from
 * being run unattended. Any non-local target still has to be typed out.
 */
export async function confirmTarget(t: Target, what: string): Promise<void> {
  if (t.isLocal) {
    console.log(`\nLocal sandbox (${t.database}) — no confirmation needed. About to ${what}.`)
    return
  }
  console.log(`\nAbout to ${what}.`)
  await confirmExact(`Type the database name to continue (${t.database}): `, t.database)
}

// ─── CLI: resolve and describe, write nothing ────────────────────────────────
async function main() {
  const target = await resolveTarget({ readOnly: true })
  printTarget(target)
  console.log(
    target.isLocal
      ? '\n✓ Local sandbox — this target may be written to.\n'
      : '\n✋ Not the local sandbox — dry-run/apply will refuse this target.\n',
  )
}

if (process.argv[1] && process.argv[1].endsWith('target.ts')) {
  main().catch(err => {
    console.error('\n[target] FAILED:', err)
    process.exit(1)
  })
}
