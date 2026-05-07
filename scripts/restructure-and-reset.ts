// One-shot script: align live DB with the new step structure (intake_form
// becomes a "review your forms" explicit step, session_form is removed, the
// remaining steps shift up one) AND reset the demo trainer for a clean
// fresh-signup experience.

import { PrismaClient } from '../src/generated/prisma'

const prisma = new PrismaClient()

const STEP_UPDATES = [
  {
    key: 'intake_form',
    data: {
      order: 2,
      title: 'Review your forms',
      body: "Take a look at your contact, intake, and session forms. Make sure each one asks for the info you actually need before clients start submitting them.",
      ctaLabel: 'Review forms',
      skipWarning: null,
    },
  },
  { key: 'program_package', data: { order: 3 } },
  { key: 'achievements', data: { order: 4 } },
  { key: 'client_view', data: { order: 5 } },
  { key: 'invite_client', data: { order: 6 } },
]

async function main() {
  console.log('--- Restructuring onboarding steps ---')
  for (const u of STEP_UPDATES) {
    const r = await prisma.onboardingStep.update({
      where: { key: u.key },
      data: u.data,
      select: { key: true, order: true, title: true },
    })
    console.log(`  Updated ${r.key} → order ${r.order}, "${r.title}"`)
  }

  const del = await prisma.onboardingStep.deleteMany({ where: { key: 'session_form' } })
  console.log(`  Deleted ${del.count} session_form step row(s)`)

  console.log('\n--- Resetting demo trainer (demo@pupmanager.com) ---')
  const tp = await prisma.trainerProfile.findFirst({
    where: { user: { email: 'demo@pupmanager.com' } },
    select: {
      id: true,
      _count: { select: { clients: true, embedForms: true, sessionForms: true, packages: true } },
    },
  })
  if (!tp) { console.error('No demo trainer'); process.exit(1) }

  const delProgress = await prisma.trainerOnboardingProgress.deleteMany({ where: { trainerId: tp.id } })
  console.log(`  Deleted ${delProgress.count} onboarding progress row(s)`)

  await prisma.trainerProfile.update({
    where: { id: tp.id },
    data: {
      businessName: '',
      phone: null,
      createdAt: new Date(),
    },
  })
  console.log('  Reset profile: businessName="", phone=null, createdAt=now')

  console.log('\n--- Step status the demo trainer will see after refresh ---')
  console.log(`  Step 1 (Business profile)  → PENDING (businessName cleared)`)
  console.log(`  Step 2 (Review your forms) → PENDING (explicit-only — must click "I've already done this")`)
  console.log(`  Step 3 (Add a package)     → ${tp._count.packages === 0 ? 'PENDING' : `COMPLETED (${tp._count.packages} packages exist)`}`)
  console.log(`  Step 4 (Achievements)      → PENDING (explicit-only)`)
  console.log(`  Step 5 (Client view)       → PENDING (explicit-only)`)
  console.log(`  Step 6 (Invite client)     → ${tp._count.clients === 0 ? 'PENDING' : `COMPLETED (${tp._count.clients} clients exist)`}`)
  console.log('\nTo also see steps 3 & 6 as PENDING, you would need to delete those rows manually.')
  console.log('Open in incognito or clear sessionStorage["pm-onboarding-autoopened-v1"] so the modal auto-opens.')
}

main().catch(console.error).finally(() => prisma.$disconnect())
