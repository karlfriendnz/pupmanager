// One-off: create a test CLIENT login under the demo trainer for manual QA.
// Run: npx tsx scripts/seed-test-client.ts   (delete after use)
import { prisma } from '../src/lib/prisma'
import bcrypt from 'bcryptjs'

const EMAIL = 'testclient@pupmanager.com'
const PASSWORD = 'TestPup2026!'

async function main() {
  const demoTrainerUser = await prisma.user.findUnique({
    where: { email: 'demo@pupmanager.com' },
    select: { trainerProfile: { select: { id: true } } },
  })
  const trainerId = demoTrainerUser?.trainerProfile?.id
  if (!trainerId) throw new Error('Demo trainer profile not found')

  // User + credentials account
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    create: { email: EMAIL, name: 'Aria Stewart', role: 'CLIENT', emailVerified: new Date() },
    update: { name: 'Aria Stewart', role: 'CLIENT' },
  })
  const hash = await bcrypt.hash(PASSWORD, 12)
  await prisma.account.deleteMany({ where: { userId: user.id, provider: 'credentials' } })
  await prisma.account.create({
    data: { userId: user.id, type: 'credentials', provider: 'credentials', providerAccountId: hash },
  })

  // Client profile under the demo trainer (composite unique on userId+trainerId)
  const profile = await prisma.clientProfile.upsert({
    where: { userId_trainerId: { userId: user.id, trainerId } },
    create: { userId: user.id, trainerId, status: 'ACTIVE', phone: '021 555 0177' },
    update: { status: 'ACTIVE' },
    select: { id: true, dogId: true },
  })

  // Primary dog
  let dogId = profile.dogId
  if (!dogId) {
    const dog = await prisma.dog.create({ data: { name: 'Poppy', breed: 'Golden Retriever' } })
    await prisma.clientProfile.update({ where: { id: profile.id }, data: { dogId: dog.id } })
    dogId = dog.id
  }

  // Satisfy the trainer's required intake fields so the client skips the
  // intake gate and lands on the redesigned home.
  const requiredFields = await prisma.customField.findMany({
    where: { trainerId, required: true },
    select: { id: true, type: true, appliesTo: true, options: true },
  })
  for (const f of requiredFields) {
    const opts = Array.isArray(f.options) ? (f.options as string[]) : []
    const value = f.type === 'DROPDOWN' ? (opts[0] ?? 'Yes') : f.type === 'NUMBER' ? '3' : 'Test answer'
    const forDog = (f.appliesTo ?? 'OWNER') === 'DOG'
    const where = { fieldId: f.id, clientId: profile.id, dogId: forDog ? dogId : null }
    const existing = await prisma.customFieldValue.findFirst({ where, select: { id: true } })
    if (existing) {
      await prisma.customFieldValue.update({ where: { id: existing.id }, data: { value } })
    } else {
      await prisma.customFieldValue.create({ data: { ...where, value } })
    }
  }

  // Fresh content: one upcoming session + three homework tasks this week.
  await prisma.trainingSession.deleteMany({ where: { clientId: profile.id } })
  const inTwoDays = new Date(Date.now() + 2 * 864e5)
  inTwoDays.setHours(16, 0, 0, 0)
  await prisma.trainingSession.create({
    data: { trainerId, clientId: profile.id, dogId, title: 'Loose-lead walk', scheduledAt: inTwoDays, durationMins: 45, location: 'Riverside Park', sessionType: 'IN_PERSON', status: 'UPCOMING' },
  })

  await prisma.trainingTask.deleteMany({ where: { clientId: profile.id } })
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tasks = [
    { title: 'Sit-stay', repetitions: 10 },
    { title: 'Recall practice', repetitions: null },
    { title: 'Loose-lead, 10 min', repetitions: null },
    { title: 'Place command', repetitions: 8 },
    { title: 'Settle on the mat', repetitions: null },
  ]
  for (let i = 0; i < tasks.length; i++) {
    await prisma.trainingTask.create({
      data: { clientId: profile.id, dogId, date: today, title: tasks[i].title, repetitions: tasks[i].repetitions, order: i },
    })
  }

  console.log(`\n✅ Test client ready:\n   email:    ${EMAIL}\n   password: ${PASSWORD}\n   trainer:  Demo Dog Training\n   dog: Poppy + 1 upcoming session + 5 homework tasks\n`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
