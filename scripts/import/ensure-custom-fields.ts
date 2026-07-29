/**
 * Create (idempotent) the custom fields a client's plan writes to.
 *
 * WHY THIS IS A SEPARATE STEP, AND NOT OPTIONAL
 * ---------------------------------------------
 * The loader drops a custom-field value whose label has no matching
 * CustomField on the target trainer. Silently — it counts them and moves on,
 * because failing an entire import over one unrecognised label would be
 * worse. The consequence is that forgetting this step produces an import that
 * succeeds, reports happily, and is missing every vet clinic and emergency
 * contact in the file. `dry-run.ts` lists the labels it would lose; this
 * script is how you stop losing them.
 *
 * The field list comes from the CLIENT CONFIG (`customFieldsToCreate`), not
 * from a constant in here, so the labels a client's source modules write and
 * the fields created for them are the same list in the same file.
 *
 *   ./node_modules/.bin/dotenv -e .env.development.local -o -- \
 *     npx tsx scripts/import/ensure-custom-fields.ts \
 *       --config scripts/import/clients/dukes.json \
 *       --trainer dukes@pupmanager.dev
 *
 * Arguments
 *   --trainer  required, the target trainer's login email
 *   --config   a client config to read `customFieldsToCreate` from
 *   --plan     alternatively, a plan.json — every custom-field label used in
 *              it is created. Useful for a plan whose config you do not have.
 *   --fields   alternatively, a comma-separated list of labels
 *   --type     TEXT (default) | NUMBER | DROPDOWN
 *   --category optional grouping label shown in the app
 *
 * Everything is created as an OWNER-scoped TEXT field. Both parts of that are
 * deliberate:
 *
 *   OWNER — the loader only ever writes owner-scoped values (it passes
 *   dogId: null), so a DOG-scoped field created here could never be filled.
 *
 *   TEXT — these are imported values, not a form the trainer is filling in. A
 *   DROPDOWN would need its options known up front and would reject anything
 *   the client actually typed. The trainer can tighten a field afterwards.
 *
 * Re-runnable: matches on lowercased label per trainer, never duplicates, and
 * never alters a field that already exists — the trainer may well have
 * retyped a label or changed its type on purpose.
 */
import { readFileSync } from 'fs'

import { scriptPrisma } from '../../src/lib/prisma-script'
import { arg, heading } from './loader/cli'
import { describeUrl, isLocalSandbox, maskUrl } from './loader/guard'

const prisma = scriptPrisma()

type FieldType = 'TEXT' | 'NUMBER' | 'DROPDOWN'

function requireLocalSandbox(): void {
  const url = process.env.DATABASE_URL ?? ''
  if (isLocalSandbox(url)) return
  const { host, database } = describeUrl(url)
  console.error('\n✋ Refusing to write: DATABASE_URL is not the local sandbox.')
  console.error(`   host     : ${host}`)
  console.error(`   database : ${database}`)
  console.error(`   url      : ${maskUrl(url)}`)
  console.error('\n   Run it through the dotenv wrapper, and keep the -o:')
  console.error('     ./node_modules/.bin/dotenv -e .env.development.local -o -- \\')
  console.error('       npx tsx scripts/import/ensure-custom-fields.ts --config … --trainer …\n')
  process.exit(1)
}

/** Every custom-field label the plan actually uses, in first-seen order. */
function labelsFromPlan(path: string): string[] {
  const plan = JSON.parse(readFileSync(path, 'utf8'))
  const seen: string[] = []
  for (const person of plan.people ?? []) {
    for (const label of Object.keys(person.customFields ?? {})) {
      if (!seen.includes(label)) seen.push(label)
    }
  }
  return seen
}

function labelsFromConfig(path: string): string[] {
  const config = JSON.parse(readFileSync(path, 'utf8'))
  const declared: string[] = config.customFieldsToCreate ?? []
  // A client config can also switch the toolkit's own generic fields on by
  // giving them a label; "" means off, and an off field must not be created.
  const generic: string[] = Object.values(config.customFields ?? {}).filter(
    (v): v is string => typeof v === 'string' && v.trim() !== '',
  )
  const all = [...declared, ...generic]
  return all.filter((label, i) => all.indexOf(label) === i)
}

async function main() {
  requireLocalSandbox()

  const trainerEmail = (arg('trainer') ?? '').trim().toLowerCase()
  const configPath = arg('config')
  const planPath = arg('plan')
  const explicit = arg('fields')
  const type = ((arg('type') ?? 'TEXT').toUpperCase() as FieldType)
  const category = arg('category') ?? 'Imported'

  if (!trainerEmail) {
    console.error('\n✋ --trainer <email> is required.\n')
    process.exit(1)
  }
  if (!configPath && !planPath && !explicit) {
    console.error('\n✋ Give one of --config <client.json>, --plan <plan.json> or --fields "A,B".\n')
    process.exit(1)
  }
  if (!['TEXT', 'NUMBER', 'DROPDOWN'].includes(type)) {
    console.error(`\n✋ --type must be TEXT, NUMBER or DROPDOWN (got ${type}).\n`)
    process.exit(1)
  }

  const labels = explicit
    ? explicit.split(',').map(s => s.trim()).filter(Boolean)
    : configPath
      ? labelsFromConfig(configPath)
      : labelsFromPlan(planPath as string)

  if (!labels.length) {
    console.error('\n✋ No custom-field labels found. Nothing to do.\n')
    process.exit(1)
  }

  const user = await prisma.user.findUnique({
    where: { email: trainerEmail },
    select: { trainerProfile: { select: { id: true } } },
  })
  const trainerId = user?.trainerProfile?.id
  if (!trainerId) {
    console.error(`\n✋ No trainer profile for ${trainerEmail}. Run create-trainer.ts first.\n`)
    process.exit(1)
  }

  const existing = await prisma.customField.findMany({
    where: { trainerId },
    select: { id: true, label: true, type: true, appliesTo: true, order: true },
  })
  const byLabel = new Map(existing.map(f => [f.label.trim().toLowerCase(), f]))
  let nextOrder = existing.reduce((max, f) => Math.max(max, f.order), 0)

  heading(`Custom fields for ${trainerEmail}`)
  let created = 0
  for (const label of labels) {
    const found = byLabel.get(label.trim().toLowerCase())
    if (found) {
      const scope = found.appliesTo === 'OWNER' ? '' : `  ⚠ appliesTo=${found.appliesTo} — values will not be written`
      console.log(`  = exists   ${label.padEnd(34)} ${found.type}${scope}`)
      continue
    }
    const row = await prisma.customField.create({
      data: {
        trainerId,
        label,
        type,
        options: [],
        category,
        appliesTo: 'OWNER',
        required: false,
        inQuickAdd: false,
        order: ++nextOrder,
      },
      select: { id: true },
    })
    console.log(`  + created  ${label.padEnd(34)} ${type}  (${row.id})`)
    created++
  }

  console.log(`\n✅ ${labels.length} field(s) checked, ${created} created, on trainer ${trainerId}\n`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
