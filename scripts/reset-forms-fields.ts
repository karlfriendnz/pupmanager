/**
 * Reset one trainer's fields + forms back to a fresh-signup state.
 *
 * Wipes: custom fields (and every client's answers to them, via cascade),
 * intake sections, intake published flag, the built-in client-field config,
 * and session forms (plus their responses, via cascade). Embed / lead-capture
 * forms and booking pages are left alone — they're website integration, not
 * the intake surface.
 *
 * DRY RUN BY DEFAULT. Pass --confirm to actually delete.
 *
 *   npx tsx scripts/reset-forms-fields.ts --email demo@dogtraining.co.nz
 *   npx tsx scripts/reset-forms-fields.ts --email demo@dogtraining.co.nz --confirm
 */
import { PrismaClient } from '../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'

const args = process.argv.slice(2)
const emailArg = args[args.indexOf('--email') + 1]
const confirm = args.includes('--confirm')

if (!emailArg || emailArg.startsWith('--')) {
  console.error('Usage: reset-forms-fields.ts --email <trainer email> [--confirm]')
  process.exit(1)
}

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1) }
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

async function main() {
  const host = url!.replace(/:[^:@/]+@/, ':***@').split('@')[1]?.split('/')[0]
  console.log(`DB: ${host}`)
  console.log(`Mode: ${confirm ? 'DELETE (--confirm given)' : 'DRY RUN'}\n`)

  const user = await prisma.user.findUnique({
    where: { email: emailArg },
    select: { id: true, name: true, email: true },
  })
  if (!user) { console.error(`No user with email ${emailArg}`); process.exit(1) }

  // The business this user owns (fields/forms belong to the company, not the user).
  const profile = await prisma.trainerProfile.findFirst({
    where: { userId: user.id },
    select: {
      id: true, businessName: true, intakeFormPublished: true,
      intakeSectionOrder: true, intakeSystemFieldSections: true, clientFieldConfig: true,
    },
  })
  if (!profile) { console.error(`${emailArg} owns no trainer business`); process.exit(1) }

  console.log(`Trainer: ${profile.businessName} (user ${user.email})\n`)

  const [fields, sessionForms] = await Promise.all([
    prisma.customField.findMany({
      where: { trainerId: profile.id },
      select: { id: true, label: true, category: true, _count: { select: { values: true } } },
      orderBy: { order: 'asc' },
    }),
    prisma.sessionForm.findMany({
      where: { trainerId: profile.id },
      select: { id: true, name: true, _count: { select: { responses: true } } },
    }),
  ])

  const sections = Array.isArray(profile.intakeSectionOrder) ? profile.intakeSectionOrder : []
  const answers = fields.reduce((n, f) => n + f._count.values, 0)
  const responses = sessionForms.reduce((n, f) => n + f._count.responses, 0)

  console.log(`Custom fields  : ${fields.length}`)
  for (const f of fields) {
    console.log(`   - ${f.label}${f.category ? ` [${f.category}]` : ''}${f._count.values ? `  (${f._count.values} client answers — DESTROYED)` : ''}`)
  }
  console.log(`\nIntake sections: ${sections.length}  ${JSON.stringify(sections)}`)
  console.log(`Intake published: ${profile.intakeFormPublished}`)
  const cfg = profile.clientFieldConfig as Record<string, unknown> | null
  const cfgCustomised = !!cfg && Object.keys(cfg).length > 0
  console.log(`Built-in field config: ${cfgCustomised ? 'customised (will reset to defaults)' : 'default'}`)
  console.log(`\nSession forms  : ${sessionForms.length}`)
  for (const f of sessionForms) {
    console.log(`   - ${f.name}${f._count.responses ? `  (${f._count.responses} responses — DESTROYED)` : ''}`)
  }

  console.log(`\nTotals: ${fields.length} fields, ${answers} client answers, ${sessionForms.length} session forms, ${responses} responses.`)

  if (!confirm) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --confirm to apply.')
    return
  }

  await prisma.$transaction([
    prisma.customField.deleteMany({ where: { trainerId: profile.id } }),
    prisma.sessionForm.deleteMany({ where: { trainerId: profile.id } }),
    prisma.trainerProfile.update({
      where: { id: profile.id },
      data: {
        intakeSectionOrder: [],
        intakeSystemFieldSections: {},
        intakeFormPublished: false,
        // clientFieldConfig is a non-nullable Json defaulting to {} — an empty
        // object IS the default state (resolveClientFieldConfig merges the code
        // defaults over it). `undefined` would be a silent no-op here.
        clientFieldConfig: {},
      },
    }),
  ])
  console.log('\nDone — fields and forms reset to a fresh-signup state.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
