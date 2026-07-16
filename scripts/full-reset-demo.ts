// FULL reset — wipes all trainer-owned data for demo@pupmanager.com so the
// next /dashboard load behaves exactly like a brand-new signup:
//   • welcome modal fires
//   • init helper re-seeds default forms + achievements (drafts)
//   • ALL onboarding steps start PENDING (incl. intake_form + availability)
//   • billing back to a 10-day TRIALING trial with no plan
//   • no leftover enquiries, availability slots, etc.

import { scriptPrisma } from "../src/lib/prisma-script"

const prisma = scriptPrisma()

// Mirror the real /signup flow (src/app/api/auth/signup/route.ts).
const TRIAL_DAYS = 10

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

  // Enquiries — EnquiryMessage cascades on enquiry delete, so this is enough.
  // Left behind by the old reset, which kept the inbox full of demo enquiries.
  const enquiries = await prisma.enquiry.deleteMany({ where: { trainerId } })
  console.log(`✗ ${enquiries.count} enquir(ies)`)

  // Availability slots — otherwise the "availability" onboarding step stays
  // COMPLETED (it's live-derived from availabilitySlots > 0).
  const slots = await prisma.availabilitySlot.deleteMany({ where: { trainerId } })
  console.log(`✗ ${slots.count} availability slot(s)`)

  // Onboarding progress — wiped so init re-runs and welcomeShownAt = null.
  const progress = await prisma.trainerOnboardingProgress.deleteMany({ where: { trainerId } })
  console.log(`✗ ${progress.count} onboarding progress row(s)`)

  // Reset profile fields. createdAt = now so init treats this as a fresh signup
  // (not a backfill), which means welcome modal + auto-modal both fire.
  // intakeFormPublished → false so the "intake_form" step starts PENDING (it's
  // keyed off the flag, not whether a form exists). Billing back to TRIALING
  // with a fresh trial + no plan, matching the real /signup flow.
  await prisma.trainerProfile.update({
    where: { id: trainerId },
    data: {
      businessName: '',
      phone: null,
      logoUrl: null,
      intakeSectionOrder: [],
      intakeFormPublished: false,
      // Brand + wizard fields back to defaults (null = falls back to PupManager teal).
      emailAccentColor: null,
      clientWelcomeNote: null,
      website: null,
      publicEmail: null,
      subscriptionStatus: 'TRIALING',
      subscriptionPlanId: null,
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    },
  })
  console.log('✓ Profile reset (businessName, phone, logo, sections, intakeFormPublished, billing→TRIALING, createdAt)')

  console.log('\nNext /dashboard load will:')
  console.log('  1. Re-seed default forms (1 embed, 1 session, 5 intake fields)')
  console.log('  2. Re-seed default achievements (6, all draft)')
  console.log('  3. Show welcome modal')
  console.log('  4. After welcome dismissed: every onboarding step pending')
  console.log('\nIMPORTANT: open in incognito or clear sessionStorage["pm-onboarding-autoopened-v1"]')
}

main().catch(console.error).finally(() => prisma.$disconnect())
