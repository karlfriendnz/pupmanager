// Resets the demo trainer (demo@pupmanager.com) so the onboarding wizard
// shows from step 1 as if they were a fresh signup. Non-destructive — does
// NOT touch existing clients, sessions, etc. Only resets:
//   • TrainerOnboardingProgress (deleted; cascades step progress + email log)
//   • TrainerProfile.createdAt → now (so isBackfill = false → auto-modal)
//   • TrainerProfile.businessName → 'My Business' (sentinel → step 1 pending)

import { PrismaClient } from '../src/generated/prisma'

const prisma = new PrismaClient()

const EMAIL = 'demo@pupmanager.com'

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: EMAIL },
    include: { trainerProfile: { include: { _count: { select: { clients: true, embedForms: true, sessionForms: true, packages: true } } } } },
  })

  if (!user?.trainerProfile) {
    console.error(`No trainer found for ${EMAIL}`)
    process.exit(1)
  }

  const tp = user.trainerProfile

  // 1. Delete the progress row (cascades through step progress + email log)
  const deleted = await prisma.trainerOnboardingProgress.deleteMany({ where: { trainerId: tp.id } })
  console.log(`Deleted ${deleted.count} onboarding progress row(s)`)

  // 2. Reset profile fields so init treats trainer as fresh signup
  await prisma.trainerProfile.update({
    where: { id: tp.id },
    data: {
      businessName: 'My Business',
      createdAt: new Date(),
    },
  })
  console.log('Reset trainer profile: businessName="My Business", createdAt=now')

  console.log('')
  console.log('What you will see after refresh:')
  console.log(`  Step 1 (Business profile)  → PENDING (businessName reset)`)
  console.log(`  Step 2 (Intake form)       → ${tp._count.embedForms === 0 ? 'PENDING' : 'COMPLETED (already have ' + tp._count.embedForms + ')'}`)
  console.log(`  Step 3 (Session form)      → ${tp._count.sessionForms === 0 ? 'PENDING' : 'COMPLETED (already have ' + tp._count.sessionForms + ')'}`)
  console.log(`  Step 4 (Program/package)   → ${tp._count.packages === 0 ? 'PENDING' : 'COMPLETED (already have ' + tp._count.packages + ')'}`)
  console.log(`  Step 5 (Achievements)      → PENDING (explicit-only)`)
  console.log(`  Step 6 (Client view)       → PENDING (explicit-only)`)
  console.log(`  Step 7 (Invite client)     → ${tp._count.clients === 0 ? 'PENDING' : 'COMPLETED (already have ' + tp._count.clients + ' clients)'}`)
  console.log('')
  console.log('Browser-side: also clear sessionStorage["pm-onboarding-autoopened-v1"] OR use an incognito window so the modal auto-opens.')
}

main().catch(console.error).finally(() => prisma.$disconnect())
