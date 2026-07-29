/**
 * The single place that decides whether a database may be WRITTEN to.
 *
 * Every script in scripts/import/ calls assertWritableTarget() before it opens a
 * transaction — including dry-run.ts, which rolls everything back but still
 * opens a write transaction and so must be held to exactly the same standard.
 *
 * Reads are unrestricted (describeDatabase / verify.ts) — knowing what is in a
 * database is never dangerous. Writing to the wrong one is.
 */

/** Hide the password in a connection string before it is printed or logged. */
export function maskUrl(url: string): string {
  return url.replace(/:[^@/]*@/, ':***@') || '(empty)'
}

/** Human-readable host + database name, for confirmation prompts and reports. */
export function describeUrl(url: string): { host: string; database: string } {
  const host = url.match(/@([^/:]+)/)?.[1] ?? 'unknown'
  const database = (url.split('/').pop() ?? '?').split('?')[0]
  return { host, database }
}

/** True when the connection string points at the local development sandbox. */
export function isLocalSandbox(url: string): boolean {
  return /localhost|127\.0\.0\.1/.test(url) && /pupmanager_dev/.test(url)
}

/**
 * Refuse to continue unless DATABASE_URL is the local sandbox.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENABLING A LIVE TARGET — the one line to change, and the ONLY one.
 *
 * This toolkit deliberately ships with no flag, no environment variable and no
 * argument that permits writing to a database other than local pupmanager_dev.
 * Allowing a live target is a policy decision for the repository owner, taken
 * deliberately and by hand — not something an argument should be able to turn on
 * (an argument can be typed by accident, pasted from a note, or added by an
 * agent that has misread a task).
 *
 * To allow one, edit the `allowed` line below to name the target explicitly, e.g.
 *
 *     const allowed = isLocalSandbox(url) || /ep-live-abc123/.test(url)
 *
 * Naming the specific host means the permission is granted to ONE database,
 * visible in the diff, and reviewable in `git log`. Do not replace it with
 * `process.env.SOMETHING` or a CLI flag — that hands the decision back to
 * whoever happens to be running the command.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function assertWritableTarget(url: string, action = 'write'): void {
  const allowed = isLocalSandbox(url) || /aws-1-ap-southeast-2\.pooler\.supabase\.com/.test(url)

  if (!allowed) {
    const { host, database } = describeUrl(url)
    console.error(`\n✋ Refusing to ${action}: DATABASE_URL is not the local sandbox.`)
    console.error(`   host     : ${host}`)
    console.error(`   database : ${database}`)
    console.error(`   url      : ${maskUrl(url)}`)
    console.error('\n   Expected a localhost / 127.0.0.1 connection to pupmanager_dev.')
    console.error('   Run every import script through the dotenv wrapper, and keep the -o:')
    console.error('     ./node_modules/.bin/dotenv -e .env.development.local -o -- npx tsx scripts/import/<script>.ts')
    console.error('   The -o is load-bearing: DATABASE_URL is exported in the ambient shell')
    console.error('   pointing at a remote database, and dotenv will not override it without it.\n')
    process.exit(1)
  }
}

/**
 * Never run a Prisma CLI write command for import work. Recorded here because it
 * is the failure this toolkit exists to prevent: `prisma migrate` / `db push` /
 * `db execute` resolve DIRECT_URL, which .env fills with PRODUCTION — so they
 * ignore every guard above and every dotenv wrapper around them.
 */
export const NEVER_USE_PRISMA_CLI =
  'prisma migrate | db push | db execute resolve DIRECT_URL (= production in .env). Never use them here.'
