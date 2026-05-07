// FULL reset — wipes all trainer-owned data for demo@pupmanager.com so the
// next /dashboard load behaves exactly like a brand-new signup:
//   • welcome modal fires
//   • init helper re-seeds default forms + achievements (drafts)
//   • all 6 wizard steps start PENDING

import { PrismaClient } from '../src/generated/prisma'

const prisma = new PrismaClient()

async function main() {
  const tp = await prisma.trainerProfile.findFirst({
    where: { user: { email: 'demo@pupmanager.com' } },
    select: { id: true },
  })
  if (!tp) { console.error('No demo trainer'); process.exit(1) }
  const trainerId = tp.id

  // Order matters where there are FKs without ON DELETE CASCADE.
  const sessionForms = await prisma.sessionForm.deleteMany({ where: { trainerId } })
  console.log(`✗ ${sessionForms.count} session form(s)`)

  const embedForms = await prisma.embedForm.deleteMany({ where: { trainerId } })
  console.log(`✗ ${embedForms.count} embed form(s)`)

  const customFields = await prisma.customField.deleteMany({ where: { trainerId } })
  console.log(`✗ ${customFields.count} custom field(s)`)

  const packages = await prisma.package.deleteMany({ where: { trainerId } })
  console.log(`✗ ${packages.count} package(s)`)

  const achievements = await prisma.achievement.deleteMany({ where: { trainerId } })
  console.log(`✗ ${achievements.count} achievement(s)`)

  // TrainingSession.clientId is SetNull (not Cascade) — deleting clients
  // would leave orphan sessions, so delete sessions explicitly first.
  const sessions = await prisma.trainingSession.deleteMany({ where: { trainerId } })
  console.log(`✗ ${sessions.count} training session(s)`)

  const clients = await prisma.clientProfile.deleteMany({ where: { trainerId } })
  console.log(`✗ ${clients.count} client(s)`)

  // Onboarding progress — wiped so init re-runs and welcomeShownAt = null.
  const progress = await prisma.trainerOnboardingProgress.deleteMany({ where: { trainerId } })
  console.log(`✗ ${progress.count} onboarding progress row(s)`)

  // Reset profile fields. createdAt = now so init treats this as a fresh signup
  // (not a backfill), which means welcome modal + auto-modal both fire.
  await prisma.trainerProfile.update({
    where: { id: trainerId },
    data: {
      businessName: '',
      phone: null,
      logoUrl: null,
      intakeSectionOrder: [],
      createdAt: new Date(),
    },
  })
  console.log('✓ Profile reset (businessName, phone, logo, sections, createdAt)')

  console.log('\nNext /dashboard load will:')
  console.log('  1. Re-seed default forms (1 embed, 1 session, 5 intake fields)')
  console.log('  2. Re-seed default achievements (6, all draft)')
  console.log('  3. Show welcome modal')
  console.log('  4. After welcome dismissed: wizard at step 1, all others pending')
  console.log('\nIMPORTANT: open in incognito or clear sessionStorage["pm-onboarding-autoopened-v1"]')
}

main().catch(console.error).finally(() => prisma.$disconnect())
