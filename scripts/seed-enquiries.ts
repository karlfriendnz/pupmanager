import { PrismaClient } from '@/generated/prisma'

async function main() {
  const prisma = new PrismaClient()

  // Seed against the canonical demo trainer (demo@pupmanager.com) — same
  // account used in App Review and `npm run db:seed-demo`.
  const trainer = await prisma.trainerProfile.findFirst({
    where: { user: { email: 'demo@pupmanager.com' } },
    select: { id: true, embedForms: { where: { isActive: true }, select: { id: true }, take: 1 } },
  })
  if (!trainer) throw new Error('demo@pupmanager.com trainer not found — run npm run db:seed-demo first')
  const formId = trainer.embedForms[0]?.id ?? null

  // Standard enquiry fields are now just name, email, phone, message —
  // anything dog-specific belongs in custom fields.
  const samples = [
    {
      name: 'Sarah Mitchell',
      email: 'sarah.mitchell+demo@example.com',
      phone: '+64 21 555 0101',
      message: 'Hi! My 3-year-old Lab pulls really hard on the leash. Can you help with loose-leash walking? Free Tuesday and Thursday evenings.',
      createdAt: new Date(Date.now() - 12 * 60 * 1000),
      status: 'NEW' as const,
      viewedAt: null,
    },
    {
      name: 'James Park',
      email: 'james.park+demo@example.com',
      phone: '+64 22 444 7890',
      message: 'Looking for puppy classes. Our Shiba Inu is food-motivated but suspicious of strangers.',
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      status: 'NEW' as const,
      viewedAt: null,
    },
    {
      name: 'Priya Singh',
      email: 'priya.singh+demo@example.com',
      phone: '+64 27 222 1111',
      message: 'Border Collie with so much energy and we are first-time dog owners. Help!',
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      status: 'NEW' as const,
      viewedAt: new Date(Date.now() - 20 * 60 * 60 * 1000),
    },
    {
      name: 'Tom Edwards',
      email: 'tom.edwards+demo@example.com',
      phone: '+64 21 999 0000',
      message: 'Need help with reactivity around other dogs on walks.',
      createdAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      status: 'ACCEPTED' as const,
      viewedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    },
    {
      name: 'Ann Davies',
      email: 'ann.davies+demo@example.com',
      phone: null,
      message: 'Just price-checking, will get back to you.',
      createdAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
      status: 'DECLINED' as const,
      viewedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
    },
  ]

  // Wipe any prior demo enquiries with these emails so re-running is idempotent.
  await prisma.enquiry.deleteMany({
    where: { trainerId: trainer.id, email: { in: samples.map(s => s.email) } },
  })

  for (const s of samples) {
    await prisma.enquiry.create({
      data: { ...s, trainerId: trainer.id, formId, customFieldValues: {} },
    })
  }

  const count = await prisma.enquiry.count({ where: { trainerId: trainer.id } })
  console.log(`Inserted ${samples.length} enquiries. Total for demo trainer: ${count}`)
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
