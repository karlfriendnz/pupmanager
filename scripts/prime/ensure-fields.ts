/**
 * Create (idempotent) the custom fields the PRIME PUPS / Journey import needs.
 *
 *   Volunteer         DROPDOWN ["Yes"]  — interns & volunteers from contacts.csv
 *   Professional      DROPDOWN ["Yes"]  — the "Professional Meet Ups" contacts
 *   Previous trainer  DROPDOWN ["Yes"]  — history under Allsorts / ADT / Journey
 *   Business          TEXT              — the professional's business name
 *   Credit            TEXT              — raw credit/refund notes ("$150 in CREDIT")
 *
 * Dropdowns rather than checkboxes on purpose: CustomFieldType has no boolean
 * member, and adding one means touching ~23 files that hand-write the
 * 'TEXT' | 'NUMBER' | 'DROPDOWN' union (including the public intake form and the
 * client portal). A single-option dropdown stores the same value, so swapping to
 * a real CHECKBOX type later needs no data migration.
 *
 * Run against LOCAL DEV — note the -o:
 *   dotenv -e .env.development.local -o -- tsx scripts/prime/ensure-fields.ts
 *
 * The -o (override) is load-bearing. If DATABASE_URL is already exported in the
 * shell (it is, in at least one profile here, pointing at a REMOTE database),
 * dotenv will NOT replace it and the script silently targets the wrong DB. The
 * Prisma CLI hides this because prisma.config.ts loads env itself and resolves
 * local — so `prisma` and `tsx` disagree about which database they are on.
 * assertLocalDb() below is the backstop.
 *
 * Re-runnable: matches on lowercased label per trainer, never duplicates.
 */
import { scriptPrisma } from '../../src/lib/prisma-script'

const prisma = scriptPrisma()

// Defaults to the local sandbox trainer. A live account has a different owner
// address, so name it: PRIME_TRAINER_EMAIL=someone@theirdomain.co.nz
const TRAINER_EMAIL = process.env.PRIME_TRAINER_EMAIL ?? 'journey@pupmanager.dev'

type FieldDef = {
  label: string
  type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  options: string[]
  category: string
}

const FIELDS: FieldDef[] = [
  { label: 'Volunteer', type: 'DROPDOWN', options: ['Yes'], category: 'Contact type' },
  { label: 'Professional', type: 'DROPDOWN', options: ['Yes'], category: 'Contact type' },
  { label: 'Previous trainer', type: 'DROPDOWN', options: ['Yes'], category: 'Contact type' },
  { label: 'Business', type: 'TEXT', options: [], category: 'Contact type' },
  { label: 'Credit', type: 'TEXT', options: [], category: 'Account' },
]

/**
 * The import only ever runs against the local dev database. `.env` and
 * `.env.local` in this repo both point at a REMOTE database, so a script that
 * merely inherits the ambient env would write to the wrong place.
 */
function assertLocalDb() {
  const url = process.env.DATABASE_URL ?? ''
  const local = /localhost|127\.0\.0\.1/.test(url) && /pupmanager_dev/.test(url)
  if (local) return
  if (process.env.PRIME_ALLOW_PRODUCTION === 'yes') return
  if (!local) {
    console.error('\n✋ Refusing to run: DATABASE_URL is not local pupmanager_dev.')
    console.error('   Run with: dotenv -e .env.development.local -- tsx scripts/prime/ensure-fields.ts\n')
    process.exit(1)
  }
}

async function main() {
  assertLocalDb()

  const user = await prisma.user.findUnique({
    where: { email: TRAINER_EMAIL },
    select: { trainerProfile: { select: { id: true } } },
  })
  const trainerId = user?.trainerProfile?.id
  if (!trainerId) {
    console.error(`\n✋ No trainer profile for ${TRAINER_EMAIL}. Run create-trainer.ts first.\n`)
    process.exit(1)
  }

  const existing = await prisma.customField.findMany({
    where: { trainerId },
    select: { id: true, label: true, type: true, options: true, order: true },
  })
  const byLabel = new Map(existing.map((f) => [f.label.trim().toLowerCase(), f]))
  let nextOrder = existing.reduce((max, f) => Math.max(max, f.order), 0)

  for (const def of FIELDS) {
    const found = byLabel.get(def.label.toLowerCase())

    if (!found) {
      const created = await prisma.customField.create({
        data: {
          trainerId,
          label: def.label,
          type: def.type,
          options: def.options,
          category: def.category,
          appliesTo: 'OWNER',
          required: false,
          inQuickAdd: false,
          order: ++nextOrder,
        },
        select: { id: true },
      })
      console.log(`  + created  ${def.label.padEnd(18)} ${def.type}  (${created.id})`)
      continue
    }

    // Present already — only repair it if the shape drifted, so re-runs are quiet.
    const currentOptions = Array.isArray(found.options) ? (found.options as string[]) : []
    const sameOptions =
      currentOptions.length === def.options.length &&
      currentOptions.every((o, i) => o === def.options[i])

    if (found.type === def.type && sameOptions) {
      console.log(`  = exists   ${def.label.padEnd(18)} ${found.type}  (${found.id})`)
    } else {
      await prisma.customField.update({
        where: { id: found.id },
        data: { type: def.type, options: def.options },
      })
      console.log(`  ~ repaired ${def.label.padEnd(18)} ${found.type} → ${def.type}  (${found.id})`)
    }
  }

  console.log(`\n✅ Custom fields ready on trainer ${trainerId}\n`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
