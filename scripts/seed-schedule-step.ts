// One-shot: insert the new schedule_session onboarding step into the live DB.

import { scriptPrisma } from "../src/lib/prisma-script"

const prisma = scriptPrisma()

async function main() {
  const r = await prisma.onboardingStep.upsert({
    where: { key: 'schedule_session' },
    create: {
      key: 'schedule_session',
      order: 7,
      title: 'Schedule a session',
      body: "Book your first training session with a client. They'll get a reminder before it starts and the session shows up on their dashboard.",
      ctaLabel: 'Open the schedule',
      ctaHref: '/schedule',
      skippable: true,
      skipWarning: null,
      publishedAt: new Date(),
    },
    update: { order: 7 },
  })
  console.log('Seeded step:', r.key, 'order', r.order)
}

main().catch(console.error).finally(() => prisma.$disconnect())
