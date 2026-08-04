import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A migration that names a Prisma MODEL instead of its table takes production
 * down.
 *
 * Every model in this schema carries an `@@map` — `TrainerProfile` is the table
 * `trainer_profiles`. A hand-written migration that says `ALTER TABLE
 * "TrainerProfile"` fails `migrate deploy` with 42P01, and because Vercel runs
 * migrations as part of the build, the whole deploy dies with it. That has
 * happened here before.
 *
 * It matters more than usual right now: production is 20 migrations behind, so
 * they apply as a queue. ONE bad file blocks the other nineteen, and the failure
 * arrives as a red build rather than as anything about the migration.
 *
 * Columns are camelCase and models are PascalCase, so a quoted identifier
 * starting with a capital that matches a model name is the mistake — and enums,
 * which are also PascalCase and legitimately appear in CREATE TYPE, are excluded
 * by name.
 */

const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const MIGRATIONS = join(process.cwd(), 'prisma/migrations')

const modelNames = [...SCHEMA.matchAll(/^model (\w+) \{/gm)].map(m => m[1])
const enumNames = [...SCHEMA.matchAll(/^enum (\w+) \{/gm)].map(m => m[1])

function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter(d => /^\d/.test(d) && statSync(join(MIGRATIONS, d)).isDirectory())
    .map(d => ({ name: d, sql: readFileSync(join(MIGRATIONS, d, 'migration.sql'), 'utf8') }))
}

/** SQL with the comments taken out — a model name in prose is not a bug. */
function withoutComments(sql: string): string {
  return sql
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('every migration names tables, not Prisma models', () => {
  const files = migrationFiles()

  it('found the migrations and the schema', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(modelNames.length).toBeGreaterThan(50)
  })

  it('every model has an @@map, so the table name is never the model name', () => {
    // The premise of this whole test. If a model without @@map ever appears,
    // its table IS its model name and the check below would flag a correct file.
    const unmapped: string[] = []
    let current = ''
    let mapped = false
    for (const line of SCHEMA.split('\n')) {
      const model = /^model (\w+) \{/.exec(line)
      if (model) { current = model[1]; mapped = false; continue }
      if (/@@map\(/.test(line)) mapped = true
      if (/^\}/.test(line) && current) {
        if (!mapped) unmapped.push(current)
        current = ''
      }
    }
    expect(unmapped, 'these models have no @@map — this test needs updating').toEqual([])
  })

  it('no migration quotes a model name where a table belongs', () => {
    const offenders: string[] = []
    for (const file of files) {
      const sql = withoutComments(file.sql)
      for (const model of modelNames) {
        if (enumNames.includes(model)) continue
        if (new RegExp(`"${model}"`).test(sql)) {
          offenders.push(`${file.name} → "${model}" (a model; the table is its @@map name)`)
        }
      }
    }
    expect(
      offenders,
      `\nThis migration names a Prisma model where SQL needs a table.\n\n` +
      `It fails migrate deploy with 42P01, and Vercel runs migrations during the\n` +
      `build — so the deploy dies and takes every queued migration with it.\n` +
      `Use the @@map name from schema.prisma (TrainerProfile → trainer_profiles).\n`,
    ).toEqual([])
  })

  /**
   * Replay-safe from 2026-08-01 on.
   *
   * The 2026-08-05 deploy failed on its first attempt with 42710 — `type
   * "MessageGroupMode" already exists`. The group-chat work had been pushed to
   * production with `prisma db push` while it was being built, so the objects
   * were there and _prisma_migrations knew nothing about them. The FIRST of
   * twenty queued migrations aborted and took the other nineteen with it.
   *
   * `db push` against production is a habit this repo has (see the warning in
   * AGENTS.md about DIRECT_URL), so a migration must apply to a database that
   * already has its objects. Older migrations are grandfathered: they are
   * applied everywhere already, and rewriting them would change checksums.
   */
  const CUTOFF = '20260801'

  it('every migration since the cutoff can be applied twice', () => {
    const unguarded: string[] = []
    for (const file of files) {
      if (file.name < CUTOFF) continue
      const sql = withoutComments(file.sql)
      const problems: string[] = []
      if (/CREATE TABLE "/.test(sql)) problems.push('CREATE TABLE without IF NOT EXISTS')
      if (/CREATE (UNIQUE )?INDEX "/.test(sql)) problems.push('CREATE INDEX without IF NOT EXISTS')
      if (/ADD COLUMN "/.test(sql)) problems.push('ADD COLUMN without IF NOT EXISTS')
      if (/ADD VALUE '/.test(sql)) problems.push('ADD VALUE without IF NOT EXISTS')
      // A bare CREATE TYPE / ADD CONSTRAINT is fine only inside a DO block that
      // swallows duplicate_object.
      // Two guard styles are in use here and both are fine: swallow the
      // duplicate_object exception, or check the catalogue first. The dress
      // rehearsal (replaying all 20 against a full database) is what proves it;
      // this only checks the shape.
      const guardCount =
        (sql.match(/EXCEPTION\s+WHEN duplicate_object/gi) ?? []).length +
        (sql.match(/IF NOT EXISTS \(SELECT 1 FROM pg_(type|constraint|class|indexes)/g) ?? []).length
      const needsGuard =
        (sql.match(/CREATE TYPE "/g) ?? []).length + (sql.match(/ADD CONSTRAINT "/g) ?? []).length
      if (needsGuard > 0 && guardCount === 0) problems.push('CREATE TYPE / ADD CONSTRAINT with no duplicate_object guard')
      if (problems.length) unguarded.push(`${file.name}: ${problems.join('; ')}`)
    }
    expect(
      unguarded,
      `\nThis migration cannot be applied to a database that already has its\n` +
      `objects — which production may well be, because db push has been run\n` +
      `against it before. One of these took a whole deploy down on 2026-08-05.\n\n` +
      `Use IF NOT EXISTS, and wrap CREATE TYPE / ADD CONSTRAINT in\n` +
      `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;\n`,
    ).toEqual([])
  })
})
