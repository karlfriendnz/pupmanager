// Wipes all forms (EmbedForm, SessionForm, INTAKE CustomFields) for the demo
// trainer so the "Review your forms" step starts from a clean slate.

import { PrismaClient } from '../src/generated/prisma'

const prisma = new PrismaClient()

async function main() {
  const tp = await prisma.trainerProfile.findFirst({
    where: { user: { email: 'demo@pupmanager.com' } },
    select: { id: true },
  })
  if (!tp) { console.error('No demo trainer'); process.exit(1) }

  const embed = await prisma.embedForm.deleteMany({ where: { trainerId: tp.id } })
  console.log(`Deleted ${embed.count} embed form(s)`)

  const session = await prisma.sessionForm.deleteMany({ where: { trainerId: tp.id } })
  console.log(`Deleted ${session.count} session form(s)`)

  const intakeFields = await prisma.customField.deleteMany({
    where: { trainerId: tp.id, category: 'INTAKE' },
  })
  console.log(`Deleted ${intakeFields.count} intake custom field(s)`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
