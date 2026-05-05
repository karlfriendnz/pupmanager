// Demo account seeder for App Store reviewers and live demos.
//
// Run with: `npm run db:seed-demo`
//
// Idempotent — re-running clears the demo trainer's old data and recreates a
// fresh, realistic state (clients, dogs, today's + tomorrow's sessions, a
// week of completed tasks) so the reviewer always sees a populated dashboard.

import { PrismaClient } from '../src/generated/prisma'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const DEMO_EMAIL = 'demo@pupmanager.com'
const DEMO_PASSWORD = 'DemoPup2026!' // documented in App Review Information
const DEMO_BUSINESS = 'Demo Dog Training'

async function main() {
  console.log(`Seeding demo trainer: ${DEMO_EMAIL}`)

  // 1. Trainer user + credentials
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12)
  const trainer = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: {
      name: 'Demo Trainer',
      email: DEMO_EMAIL,
      role: 'TRAINER',
      emailVerified: new Date(),
      timezone: 'Pacific/Auckland',
    },
    update: { name: 'Demo Trainer', role: 'TRAINER' },
  })

  await prisma.account.upsert({
    where: { provider_providerAccountId: { provider: 'credentials', providerAccountId: passwordHash } },
    create: { userId: trainer.id, type: 'credentials', provider: 'credentials', providerAccountId: passwordHash },
    update: {},
  }).catch(async () => {
    // Hash differs each run because bcrypt salt — delete the old credentials
    // row for this user and re-create.
    await prisma.account.deleteMany({ where: { userId: trainer.id, provider: 'credentials' } })
    await prisma.account.create({
      data: { userId: trainer.id, type: 'credentials', provider: 'credentials', providerAccountId: passwordHash },
    })
  })

  const trainerProfile = await prisma.trainerProfile.upsert({
    where: { userId: trainer.id },
    create: { userId: trainer.id, businessName: DEMO_BUSINESS },
    update: { businessName: DEMO_BUSINESS },
  })

  // 2. Wipe prior demo-owned data. Order matters because dogs aren't cascaded
  //    when their ClientProfile is deleted — collect their IDs first so we can
  //    drop them after the profiles are gone.
  const priorClientProfiles = await prisma.clientProfile.findMany({
    where: { trainerId: trainerProfile.id },
    select: { id: true, dogId: true, userId: true },
  })
  const priorDogIds = priorClientProfiles.map(c => c.dogId).filter((x): x is string => Boolean(x))
  const priorClientUserIds = priorClientProfiles.map(c => c.userId)

  await prisma.trainingSession.deleteMany({ where: { trainerId: trainerProfile.id } })
  await prisma.clientProfile.deleteMany({ where: { trainerId: trainerProfile.id } })
  if (priorDogIds.length > 0) {
    await prisma.dog.deleteMany({ where: { id: { in: priorDogIds } } })
  }
  // Also remove the demo client User rows so re-runs don't leave a growing
  // pile of orphan users with no client profile.
  if (priorClientUserIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: priorClientUserIds }, email: { endsWith: '@pupmanager.test' } },
    })
  }

  // 3. Three demo clients with one dog each
  const clients = [
    { name: 'Liz Reed',      email: 'demo-liz@pupmanager.test',     dog: 'Rusty',   breed: 'Border Collie' },
    { name: 'Brooke Friend', email: 'demo-brooke@pupmanager.test',  dog: 'Mila',    breed: 'Cavoodle' },
    { name: 'Grace Wilshaw', email: 'demo-grace@pupmanager.test',   dog: 'Tilly',   breed: 'Labrador' },
  ]

  const createdClients = await Promise.all(clients.map(async c => {
    const u = await prisma.user.upsert({
      where: { email: c.email },
      create: { name: c.name, email: c.email, role: 'CLIENT', emailVerified: new Date() },
      update: { name: c.name },
    })
    const cp = await prisma.clientProfile.create({
      data: { userId: u.id, trainerId: trainerProfile.id },
    })
    const dog = await prisma.dog.create({
      data: { name: c.dog, breed: c.breed },
    })
    const cpWithDog = await prisma.clientProfile.update({
      where: { id: cp.id },
      data: { dogId: dog.id },
    })
    return { user: u, profile: cpWithDog, dog }
  }))

  // 4. Sessions — past (completed), today (upcoming), tomorrow (upcoming)
  const now = new Date()
  const at = (daysFromToday: number, hour: number, minute = 0) => {
    const d = new Date(now)
    d.setDate(d.getDate() + daysFromToday)
    d.setHours(hour, minute, 0, 0)
    return d
  }

  const sessionRows = [
    { client: createdClients[0], when: at(-2, 14),  title: 'Walk & Coach',           status: 'COMPLETED' as const },
    { client: createdClients[1], when: at(-1, 10),  title: 'Puppy Foundations',       status: 'COMPLETED' as const },
    { client: createdClients[0], when: at(0, 14, 30), title: 'Loose-leash walking',  status: 'UPCOMING'  as const },
    { client: createdClients[2], when: at(0, 16, 15), title: 'Recall practice',      status: 'UPCOMING'  as const },
    { client: createdClients[1], when: at(1, 11),   title: 'Crate training',          status: 'UPCOMING'  as const },
    { client: createdClients[2], when: at(2, 9),    title: 'Reactivity check-in',     status: 'UPCOMING'  as const },
  ]

  for (const s of sessionRows) {
    await prisma.trainingSession.create({
      data: {
        trainerId: trainerProfile.id,
        clientId: s.client.profile.id,
        dogId: s.client.dog.id,
        title: s.title,
        scheduledAt: s.when,
        durationMins: 60,
        status: s.status,
      },
    })
  }

  // 5. A few daily training tasks per client across the last week, with
  //    realistic completion (~70%) so the dashboard's compliance widget shows
  //    a populated chart rather than 0% / 100%.
  const taskTitles = [
    'Sit / stay (3×)',
    'Recall practice (5 min)',
    'Loose-leash walk',
    'Settle on mat',
    'Touch / hand target',
  ]
  const sevenDaysAgo = at(-7, 9)
  for (const c of createdClients) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(sevenDaysAgo)
      date.setDate(date.getDate() + d)
      date.setHours(0, 0, 0, 0)
      for (const title of taskTitles.slice(0, 3)) {
        const task = await prisma.trainingTask.create({
          data: {
            clientId: c.profile.id,
            dogId: c.dog.id,
            date,
            title,
            repetitions: 5,
          },
        })
        // 70% completed, weighted toward earlier days (more realistic)
        if (Math.random() < 0.7 - d * 0.04) {
          await prisma.taskCompletion.create({
            data: { taskId: task.id, completedAt: new Date(date.getTime() + 12 * 3600_000) },
          })
        }
      }
    }
  }

  console.log(`✓ Demo trainer ready`)
  console.log(`  Email:    ${DEMO_EMAIL}`)
  console.log(`  Password: ${DEMO_PASSWORD}`)
  console.log(`  Clients:  ${createdClients.length}`)
  console.log(`  Sessions: ${sessionRows.length}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
