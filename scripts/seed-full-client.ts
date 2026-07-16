// Seed ONE fully-populated client for local QA — every section of the redesigned
// client home page has real content to show. Attaches to the local demo trainer
// ("Demo Dog Training"), which already owns featured products, digital library
// products and published achievements; this script adds the client-side data
// (dog + gallery, upcoming + completed sessions, homework, a trainer message,
// earned/in-progress achievements) plus the trainer's welcome note.
//
// Local dev DB only. Run: npm run db:seed-full-client:dev   (idempotent — re-run freely)
import { prisma } from '../src/lib/prisma'
import bcrypt from 'bcryptjs'
import { evaluateAchievementsFor } from '../src/lib/achievements'

const EMAIL = 'karl+test123@getfrello.com'
const PASSWORD = 'TestPup2026!'
const NAME = 'Karl Test'

// Plain <img> everywhere on the client home, so external Unsplash URLs are fine.
const DOG_PHOTO = 'https://images.unsplash.com/photo-1633722715463-d30f4f325e24?w=1200&q=80'
const GALLERY = [
  'https://images.unsplash.com/photo-1552053831-71594a27632d?w=1200&q=80',
  'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=1200&q=80',
  'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=1200&q=80',
]
const SESSION_IMG = 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=1200&q=80'

async function main() {
  // Demo trainer + its user (welcome-note owner + message sender).
  const demo = await prisma.user.findUnique({
    where: { email: 'demo@pupmanager.com' },
    select: { id: true, trainerProfile: { select: { id: true, clientWelcomeNote: true } } },
  })
  const trainerId = demo?.trainerProfile?.id
  const trainerUserId = demo?.id
  if (!trainerId || !trainerUserId) {
    throw new Error('Demo trainer not found — run `npm run db:seed:dev` first')
  }

  // 1. Welcome note (only if the trainer doesn't already have one).
  if (!demo!.trainerProfile!.clientWelcomeNote) {
    await prisma.trainerProfile.update({
      where: { id: trainerId },
      data: {
        clientWelcomeNote:
          "Welcome to Demo Dog Training! We're so glad to have you and Biscuit with us. " +
          'Everything you need — your sessions, homework, and progress — lives right here. Any questions, just message us.',
      },
    })
  }

  // 2. User + credentials login.
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    create: { email: EMAIL, name: NAME, role: 'CLIENT', emailVerified: new Date() },
    update: { name: NAME, role: 'CLIENT', emailVerified: new Date() },
  })
  const hash = await bcrypt.hash(PASSWORD, 12)
  await prisma.account.deleteMany({ where: { userId: user.id, provider: 'credentials' } })
  await prisma.account.create({
    data: { userId: user.id, type: 'credentials', provider: 'credentials', providerAccountId: hash },
  })

  // 3. Client profile under the demo trainer (composite unique userId+trainerId).
  const profile = await prisma.clientProfile.upsert({
    where: { userId_trainerId: { userId: user.id, trainerId } },
    create: { userId: user.id, trainerId, status: 'ACTIVE', phone: '021 555 0123' },
    update: { status: 'ACTIVE', phone: '021 555 0123' },
    select: { id: true, dogId: true },
  })

  // 4. Primary dog with a photo (hides the "add a photo" nudge) + gallery.
  let dogId = profile.dogId
  if (!dogId) {
    const dog = await prisma.dog.create({ data: { name: 'Biscuit', breed: 'Golden Retriever', photoUrl: DOG_PHOTO } })
    await prisma.clientProfile.update({ where: { id: profile.id }, data: { dogId: dog.id } })
    dogId = dog.id
  } else {
    await prisma.dog.update({ where: { id: dogId }, data: { name: 'Biscuit', breed: 'Golden Retriever', photoUrl: DOG_PHOTO } })
  }
  await prisma.dogMedia.deleteMany({ where: { dogId } })
  for (let i = 0; i < GALLERY.length; i++) {
    await prisma.dogMedia.create({ data: { dogId, trainerId, kind: 'IMAGE', url: GALLERY[i], order: i } })
  }

  // 5. Satisfy the trainer's required intake fields so the client skips the
  //    intake gate and lands straight on the home page.
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
    if (existing) await prisma.customFieldValue.update({ where: { id: existing.id }, data: { value } })
    else await prisma.customFieldValue.create({ data: { ...where, value } })
  }

  // 6. Sessions — one upcoming ("Up next") + two completed ("Last session",
  //    and they feed the achievement counters). One completed carries a photo.
  await prisma.trainingSession.deleteMany({ where: { clientId: profile.id } })
  const upcoming = new Date(Date.now() + 2 * 864e5); upcoming.setHours(16, 0, 0, 0)
  await prisma.trainingSession.create({
    data: { trainerId, clientId: profile.id, dogId, title: 'Loose-lead walk', scheduledAt: upcoming, durationMins: 45, location: 'Riverside Park', sessionType: 'IN_PERSON', status: 'UPCOMING' },
  })
  const past1 = new Date(Date.now() - 3 * 864e5); past1.setHours(10, 0, 0, 0)
  const past2 = new Date(Date.now() - 9 * 864e5); past2.setHours(10, 0, 0, 0)
  const done1 = await prisma.trainingSession.create({
    data: { trainerId, clientId: profile.id, dogId, title: 'Puppy foundations', scheduledAt: past1, durationMins: 60, location: 'Training studio', sessionType: 'IN_PERSON', status: 'COMPLETED' },
  })
  await prisma.trainingSession.create({
    data: { trainerId, clientId: profile.id, dogId, title: 'Recall basics', scheduledAt: past2, durationMins: 60, location: 'Training studio', sessionType: 'IN_PERSON', status: 'COMPLETED' },
  })
  await prisma.sessionAttachment.create({
    data: { sessionId: done1.id, trainerId, kind: 'IMAGE', url: SESSION_IMG, caption: 'Great focus today!', sizeBytes: 245_000 },
  })

  // 7. Homework this week ("This week").
  await prisma.trainingTask.deleteMany({ where: { clientId: profile.id } })
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tasks = [
    { title: 'Sit-stay, build to 30s', repetitions: 10 },
    { title: 'Recall in the garden', repetitions: null },
    { title: 'Loose-lead, 10 min', repetitions: null },
    { title: 'Settle on the mat', repetitions: 8 },
  ]
  for (let i = 0; i < tasks.length; i++) {
    await prisma.trainingTask.create({
      data: { clientId: profile.id, dogId, date: today, title: tasks[i].title, repetitions: tasks[i].repetitions, order: i },
    })
  }

  // 8. A trainer → client message ("From your trainer").
  await prisma.message.deleteMany({ where: { clientId: profile.id } })
  await prisma.message.create({
    data: {
      channel: 'TRAINER_CLIENT',
      clientId: profile.id,
      senderId: trainerUserId,
      body: 'Hey Karl — Biscuit did brilliantly with the recall work today. Keep the garden practice going this week and we\'ll build on it next session! 🐾',
      readAt: null,
    },
  })

  // 9. Achievements — auto-award from the 2 completed sessions. That earns
  //    "First session done" (shows as an earned badge) and leaves "5 sessions
  //    strong" at 2/5, which drives the "Almost there!" progress card.
  await prisma.clientAchievement.deleteMany({ where: { clientId: profile.id } })
  await evaluateAchievementsFor(profile.id)

  const earned = await prisma.clientAchievement.count({ where: { clientId: profile.id } })
  console.log(
    `\n✅ Full client seeded:\n` +
    `   email:    ${EMAIL}\n` +
    `   password: ${PASSWORD}\n` +
    `   trainer:  Demo Dog Training\n` +
    `   dog:      Biscuit (+ ${GALLERY.length}-photo gallery)\n` +
    `   home:     welcome note, up-next + last session, ${tasks.length} homework, trainer message,\n` +
    `             featured products, library, ${earned} earned achievement(s) + progress\n`
  )
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
