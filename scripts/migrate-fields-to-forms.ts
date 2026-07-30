/**
 * Give every trainer's existing client fields a home in the form builder.
 *
 * WHY: the builder is becoming the one place a client field is made. A trainer
 * whose fields were all created on the old "Your fields" screen would otherwise
 * open the builder and find nothing — their fields would still be collecting
 * answers, still on the profile, still sorting the clients list, but invisible in
 * the place they're now told to manage them. This builds each trainer a form made
 * of the fields they already have.
 *
 * WHAT IT DOES NOT DO: it never touches CustomField or CustomFieldValue. Nothing
 * is renamed, retyped, moved or deleted, and no answer is rewritten — the fields
 * stay exactly as they are and keep being read the usual way. All this adds is a
 * Form whose questions LINK to them.
 *
 * SAFE BY DEFAULT, in three ways:
 *   • The form is a DRAFT (isActive: false). A live intake form gates clients
 *     behind it before they reach their home screen, so publishing one on a
 *     trainer's behalf could lock their clients out of the app overnight. They
 *     publish it when they've looked at it.
 *   • Fields already on one of that trainer's forms are skipped, so a trainer who
 *     has started using the builder doesn't get a duplicate of their own work.
 *   • Re-running is a no-op: a trainer who already has the migrated form is left
 *     alone (matched on name), rather than collecting one per run.
 *
 *   DRY RUN:  npx dotenv -e .env.development.local -- npx tsx scripts/migrate-fields-to-forms.ts
 *   APPLY:    npx dotenv -e .env.development.local -- npx tsx scripts/migrate-fields-to-forms.ts --apply
 *   PROD:     npx dotenv -e .env.local -- npx tsx scripts/migrate-fields-to-forms.ts --apply
 */
import { PrismaClient } from '../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }),
})

/** What the migrated form is called. Also how a re-run recognises its own work. */
const FORM_NAME = 'Client details'

type StoredQuestion = { id: string; type: 'CUSTOM_FIELD'; customFieldId: string; required: boolean }

function questionIdFor(index: number): string {
  // Stable and readable rather than random: a re-run of the same field list
  // produces the same ids, and `q1` in the database is easy to match to the first
  // row on screen when someone is debugging a form.
  return `q${index + 1}`
}

async function main() {
  const trainers = await prisma.trainerProfile.findMany({
    where: { customFields: { some: {} } },
    select: {
      id: true,
      businessName: true,
      customFields: {
        // Their own order — this is the list they arranged on the old screen, and
        // the form should read the way that screen did.
        orderBy: { order: 'asc' },
        select: { id: true, label: true, required: true, isSample: true },
      },
      forms: { select: { id: true, name: true, questions: true } },
    },
  })

  console.log(`${trainers.length} trainer(s) have client fields${apply ? '' : ' (dry run)'}.\n`)

  let created = 0
  let skipped = 0

  for (const t of trainers) {
    // Sample/demo fields belong to seeded data, not to a real business's form.
    const fields = t.customFields.filter(f => !f.isSample)
    if (fields.length === 0) { skipped++; continue }

    if (t.forms.some(f => f.name === FORM_NAME)) {
      console.log(`  skip  ${t.businessName} — already has "${FORM_NAME}"`)
      skipped++
      continue
    }

    // Every field this trainer has already put on a form of their own.
    const alreadyOnAForm = new Set<string>()
    for (const f of t.forms) {
      const qs = Array.isArray(f.questions) ? f.questions : []
      for (const q of qs as Array<Record<string, unknown>>) {
        if (q?.type === 'CUSTOM_FIELD' && typeof q.customFieldId === 'string') {
          alreadyOnAForm.add(q.customFieldId)
        }
      }
    }

    const missing = fields.filter(f => !alreadyOnAForm.has(f.id))
    if (missing.length === 0) {
      console.log(`  skip  ${t.businessName} — all ${fields.length} field(s) are already on a form`)
      skipped++
      continue
    }

    const questions: StoredQuestion[] = missing.map((f, i) => ({
      id: questionIdFor(i),
      type: 'CUSTOM_FIELD',
      customFieldId: f.id,
      // Keep whatever the field itself demands, so the form asks for the same
      // things the old screen did.
      required: f.required,
    }))

    console.log(
      `  ${apply ? 'create' : 'would create'}  ${t.businessName} — "${FORM_NAME}" with ${questions.length} question(s)` +
      (missing.length < fields.length ? ` (${fields.length - missing.length} already on another form)` : ''),
    )

    if (apply) {
      await prisma.form.create({
        data: {
          trainerId: t.id,
          name: FORM_NAME,
          description: null,
          usableAsIntake: true,
          usableAsEnquiry: false,
          // A draft: hidden from the invite picker, and it gates nobody. Publishing
          // an intake form on a trainer's behalf would put a wall in front of every
          // client's home screen without them asking for it.
          isActive: false,
          questions: questions as unknown as object[],
          steps: [],
        },
      })
    }
    created++
  }

  console.log(`\n${apply ? 'Created' : 'Would create'} ${created} form(s); skipped ${skipped} trainer(s).`)
  if (!apply && created > 0) console.log('\nRe-run with --apply to write.')
  if (apply && created > 0) {
    console.log('Each one is a DRAFT — the trainer publishes it when they have looked at it.')
  }
}

main()
  .catch(err => { console.error(err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
