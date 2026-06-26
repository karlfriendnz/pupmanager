/**
 * Dev-only: seed a few fake email broadcasts (with delivered/opened/clicked
 * recipients) so the Marketing page shows realistic open/click stats without
 * actually sending anything. Idempotent — clears this trainer's existing
 * broadcasts first.
 *
 *   npx dotenv -e .env.development.local -- tsx prisma/seed-demo-broadcast.ts [trainerEmail]
 *
 * Defaults to the dev seed trainer (trainer@demo.co.nz).
 */
import { PrismaClient } from '../src/generated/prisma'

const prisma = new PrismaClient()

const trainerEmail = process.argv[2] ?? 'trainer@demo.co.nz'

// status spread per broadcast — `furthest state reached` per recipient.
type Spread = { subject: string; daysAgo: number; clicked: number; openedOnly: number; deliveredOnly: number; sentOnly: number }
const BROADCASTS: Spread[] = [
  { subject: 'New puppy class spots just opened 🐾', daysAgo: 2, clicked: 9, openedOnly: 11, deliveredOnly: 5, sentOnly: 1 },
  { subject: 'Your June training recap', daysAgo: 9, clicked: 4, openedOnly: 13, deliveredOnly: 8, sentOnly: 2 },
  { subject: 'Holiday closure dates + booking ahead', daysAgo: 21, clicked: 2, openedOnly: 6, deliveredOnly: 9, sentOnly: 5 },
]

function rows(broadcastId: string, s: Spread, emailFor: (i: number) => { email: string; clientProfileId: string | null }) {
  const out: {
    broadcastId: string; clientProfileId: string | null; email: string
    status: string; openedAt: Date | null; clickedAt: Date | null; createdAt: Date
  }[] = []
  const base = new Date(Date.now() - s.daysAgo * 24 * 60 * 60 * 1000)
  let i = 0
  const push = (status: string, opened: boolean, clicked: boolean) => {
    const { email, clientProfileId } = emailFor(i)
    out.push({
      broadcastId, clientProfileId, email, status,
      openedAt: opened ? new Date(base.getTime() + 3 * 3600_000) : null,
      clickedAt: clicked ? new Date(base.getTime() + 4 * 3600_000) : null,
      createdAt: base,
    })
    i++
  }
  for (let n = 0; n < s.clicked; n++) push('CLICKED', true, true)
  for (let n = 0; n < s.openedOnly; n++) push('OPENED', true, false)
  for (let n = 0; n < s.deliveredOnly; n++) push('DELIVERED', false, false)
  for (let n = 0; n < s.sentOnly; n++) push('SENT', false, false)
  return out
}

async function main() {
  const trainer = await prisma.trainerProfile.findFirst({
    where: { user: { email: trainerEmail } },
    select: { id: true, user: { select: { id: true } } },
  })
  if (!trainer) {
    console.error(`No trainer found for ${trainerEmail}. Pass a trainer login email as an argument.`)
    process.exit(1)
  }

  // Real client profiles (for clientProfileId + email realism); fall back to
  // synthetic addresses when the trainer has few clients.
  const clients = await prisma.clientProfile.findMany({
    where: { trainerId: trainer.id },
    select: { id: true, user: { select: { email: true } } },
    take: 60,
  })
  const pool = clients
    .filter(c => c.user.email && !c.user.email.endsWith('@no-email.pupmanager.app'))
    .map(c => ({ email: c.user.email, clientProfileId: c.id }))
  const emailFor = (i: number) =>
    pool.length > 0 ? pool[i % pool.length] : { email: `demo-client-${i}@example.com`, clientProfileId: null }

  // Clear prior demo broadcasts for a clean, repeatable result.
  await prisma.emailBroadcast.deleteMany({ where: { trainerId: trainer.id } })

  for (const s of BROADCASTS) {
    const total = s.clicked + s.openedOnly + s.deliveredOnly + s.sentOnly
    const broadcast = await prisma.emailBroadcast.create({
      data: {
        trainerId: trainer.id,
        senderId: trainer.user.id,
        subject: s.subject,
        body: `<p>Hi {{clientName}}, this is a demo broadcast preview.</p>`,
        recipientCount: total,
        createdAt: new Date(Date.now() - s.daysAgo * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    })
    await prisma.emailBroadcastRecipient.createMany({ data: rows(broadcast.id, s, emailFor) })
    console.log(`✓ ${s.subject} — ${total} recipients (${s.clicked + s.openedOnly} opened, ${s.clicked} clicked)`)
  }

  console.log(`\nDone. Log in as ${trainerEmail} and open /marketing to see the stats.`)
}

main().finally(() => prisma.$disconnect())
