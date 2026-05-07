// One-shot: seed the default forms for the demo trainer right now (rather
// than waiting for them to hit the dashboard, which would do this via the
// init helper). Useful after a forms-wipe.

import { PrismaClient } from '../src/generated/prisma'
import { seedDefaultFormsFor } from '../src/lib/onboarding/form-defaults'

const prisma = new PrismaClient()

async function main() {
  const tp = await prisma.trainerProfile.findFirst({
    where: { user: { email: 'demo@pupmanager.com' } },
    select: { id: true },
  })
  if (!tp) { console.error('No demo trainer'); process.exit(1) }

  await seedDefaultFormsFor(prisma, tp.id)

  const counts = await prisma.trainerProfile.findUnique({
    where: { id: tp.id },
    select: {
      _count: { select: { embedForms: true, sessionForms: true, customFields: true } },
    },
  })
  console.log('After seeding:')
  console.log(`  embed forms:   ${counts?._count.embedForms}`)
  console.log(`  session forms: ${counts?._count.sessionForms}`)
  console.log(`  custom fields: ${counts?._count.customFields}`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
