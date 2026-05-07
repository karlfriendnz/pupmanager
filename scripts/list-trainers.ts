import { PrismaClient } from '../src/generated/prisma'

const prisma = new PrismaClient()

async function main() {
  const trainers = await prisma.trainerProfile.findMany({
    select: {
      id: true,
      businessName: true,
      createdAt: true,
      user: { select: { email: true, name: true } },
      _count: { select: { clients: true, embedForms: true, sessionForms: true, packages: true, achievements: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  for (const t of trainers) {
    console.log(`[${t.id}]`)
    console.log(`  user:     ${t.user.name} <${t.user.email}>`)
    console.log(`  business: ${t.businessName}`)
    console.log(`  created:  ${t.createdAt.toISOString()}`)
    console.log(`  data:     ${t._count.clients} clients, ${t._count.embedForms} embed forms, ${t._count.sessionForms} session forms, ${t._count.packages} packages, ${t._count.achievements} achievements`)
    console.log('')
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
