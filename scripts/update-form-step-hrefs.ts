// Updates the live OnboardingStep rows for intake_form + session_form so their
// CTAs point at the Settings → Forms tab instead of the broken /forms route.

import { PrismaClient } from '../src/generated/prisma'

const prisma = new PrismaClient()

async function main() {
  const updates = [
    { key: 'intake_form', ctaHref: '/settings#forms' },
    { key: 'session_form', ctaHref: '/settings#forms' },
  ]
  for (const u of updates) {
    const r = await prisma.onboardingStep.update({
      where: { key: u.key },
      data: { ctaHref: u.ctaHref },
      select: { key: true, ctaHref: true, title: true },
    })
    console.log(`Updated ${r.key} → ${r.ctaHref}  (${r.title})`)
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
