import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Admin user
  const adminEmail = 'admin@pupmanager.app'
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } })

  if (!existing) {
    const hash = await bcrypt.hash('admin1234', 12)
    const admin = await prisma.user.create({
      data: {
        name: 'Platform Admin',
        email: adminEmail,
        role: 'ADMIN',
        emailVerified: new Date(),
      },
    })
    await prisma.account.create({
      data: {
        userId: admin.id,
        type: 'credentials',
        provider: 'credentials',
        providerAccountId: hash,
      },
    })
    console.log('Created admin user:', adminEmail)
  }

  // Demo trainer
  const trainerEmail = 'trainer@demo.co.nz'
  const existingTrainer = await prisma.user.findUnique({ where: { email: trainerEmail } })

  if (!existingTrainer) {
    const hash = await bcrypt.hash('trainer1234', 12)
    const trainer = await prisma.user.create({
      data: {
        name: 'Sam Trainer',
        email: trainerEmail,
        role: 'TRAINER',
        emailVerified: new Date(),
      },
    })
    await prisma.account.create({
      data: {
        userId: trainer.id,
        type: 'credentials',
        provider: 'credentials',
        providerAccountId: hash,
      },
    })
    await prisma.trainerProfile.create({
      data: {
        userId: trainer.id,
        businessName: 'Pawsome Dog Training',
      },
    })
    console.log('Created demo trainer:', trainerEmail)
  }

  // Subscription plans
  const plans = [
    { name: 'Starter', priceMonthly: 0, maxClients: 3, description: 'Perfect for getting started' },
    { name: 'Pro', priceMonthly: 29, maxClients: 25, description: 'For growing trainers' },
    { name: 'Unlimited', priceMonthly: 79, maxClients: null, description: 'No limits' },
  ]

  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { id: plan.name.toLowerCase() },
      create: { id: plan.name.toLowerCase(), ...plan },
      update: plan,
    })
  }

  console.log('Seed complete.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
