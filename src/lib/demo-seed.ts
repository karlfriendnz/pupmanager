// Shared demo-seed engine. Same logic powers the `db:seed-demo` /
// `db:reset-demo` CLI scripts and the admin panel's Seed / Reset buttons.
//
// Scope: a single trainer (the demo trainer, but the API accepts any
// trainerId so we could repurpose this for QA snapshots later).
//
//   resetDemoData(trainerId)   – wipes every client-facing record for
//                                that trainer; leaves the User and
//                                TrainerProfile rows intact so the
//                                trainer can log in immediately.
//   seedDemoData(trainerId)    – calls reset() then populates a rich,
//                                realistic dataset (≈50 clients + dogs,
//                                packages, sessions, library, products,
//                                achievements, enquiries, etc.).
//
// Deterministic: uses a seeded PRNG so the same run produces the same
// data. Re-running gives a fresh dataset (after reset) with the same
// names/distributions — handy for repeatable demos.

import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '../generated/prisma'

// ─── Deterministic RNG ───────────────────────────────────────────────────────
// Mulberry32. Tiny, good enough for picking names/durations from pools.
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Static pools ────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Liz', 'Brooke', 'Grace', 'Sarah', 'Emma', 'Olivia', 'Sophie', 'Lucy', 'Ava', 'Mia',
  'Charlotte', 'Hannah', 'Zoe', 'Ella', 'Ruby', 'Lily', 'Chloe', 'Maya', 'Isla', 'Aria',
  'Jess', 'Megan', 'Kate', 'Anna', 'Holly', 'Amy', 'Bridget', 'Rachel', 'Caitlin', 'Tessa',
  'James', 'Liam', 'Noah', 'Oliver', 'Ethan', 'Jack', 'Mason', 'Henry', 'Daniel', 'Lucas',
  'Sam', 'Tom', 'Ben', 'Will', 'Joe', 'Matt', 'Nick', 'Adam', 'Ryan', 'Toby',
]

const LAST_NAMES = [
  'Reed', 'Carter', 'Wilshaw', 'Friend', 'Bennett', 'Foster', 'Hughes', 'Wood', 'Wright', 'Hall',
  'Walker', 'Allen', 'Young', 'King', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Hill',
  'Mitchell', 'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker', 'Evans', 'Edwards', 'Collins', 'Stewart',
]

const DOG_NAMES = [
  'Rusty', 'Mila', 'Tilly', 'Bailey', 'Cooper', 'Charlie', 'Buddy', 'Max', 'Daisy', 'Luna',
  'Bella', 'Ruby', 'Rosie', 'Molly', 'Poppy', 'Hazel', 'Indie', 'Nala', 'Penny', 'Lola',
  'Finn', 'Murphy', 'Oscar', 'Toby', 'Archie', 'Milo', 'Teddy', 'Harvey', 'Ollie', 'Loki',
  'Maverick', 'Scout', 'Winston', 'Bear', 'Rocky', 'Diesel', 'Koda', 'Jasper', 'Banjo', 'Otis',
  'Sadie', 'Coco', 'Pepper', 'Willow', 'Juno', 'Stella', 'Olive', 'Ginger', 'Maple', 'Pippa',
]

const BREEDS = [
  'Border Collie', 'Cavoodle', 'Labrador', 'Golden Retriever', 'Cocker Spaniel',
  'Cattle Dog', 'Kelpie', 'Beagle', 'Pug', 'French Bulldog',
  'Staffy', 'Boxer', 'Dachshund', 'Mini Schnauzer', 'Maltese',
  'Spoodle', 'Groodle', 'Border Terrier', 'Whippet', 'Husky',
  'German Shepherd', 'Pointer', 'Vizsla', 'Aussie Shepherd', 'Sheltie',
  'Greyhound', 'Mixed breed', 'Bichon', 'Rottweiler', 'Mastiff',
]

const SESSION_TITLES = [
  'Loose-leash walking',
  'Recall practice',
  'Crate training',
  'Puppy foundations',
  'Reactivity check-in',
  'Settle on mat',
  'Walk & coach',
  'Polite greetings',
  'Door manners',
  'Group walk',
  'Drop-in coaching',
  'Off-leash play & recall',
  'Calm in public',
  'Body handling',
  'Trick session',
]

const PACKAGE_DEFS: Array<{
  name: string
  description: string
  sessionCount: number
  weeksBetween: number
  durationMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  priceCents: number | null
  color: string
}> = [
  { name: 'Puppy Foundations',     description: '4 sessions covering recall, sit, drop and loose-leash basics.', sessionCount: 4, weeksBetween: 1, durationMins: 60, sessionType: 'IN_PERSON', priceCents: 38000, color: 'blue' },
  { name: 'Reactive Rover',        description: '6-session behaviour plan for leash-reactive dogs.',              sessionCount: 6, weeksBetween: 1, durationMins: 60, sessionType: 'IN_PERSON', priceCents: 72000, color: 'amber' },
  { name: 'Loose-Leash Bootcamp',  description: 'Three intensive walks focused on polite leash skills.',           sessionCount: 3, weeksBetween: 1, durationMins: 45, sessionType: 'IN_PERSON', priceCents: 28500, color: 'emerald' },
  { name: 'Virtual Coaching',      description: 'Weekly Zoom check-ins for owners working through a plan.',        sessionCount: 4, weeksBetween: 1, durationMins: 30, sessionType: 'VIRTUAL',   priceCents: 22000, color: 'cyan' },
  { name: 'Confident Adolescent',  description: '8-week programme for dogs aged 6–18 months.',                     sessionCount: 8, weeksBetween: 1, durationMins: 60, sessionType: 'IN_PERSON', priceCents: 96000, color: 'purple' },
  { name: 'Drop-In Class',         description: 'Single ad-hoc class — useful for tune-ups or specific skills.',   sessionCount: 1, weeksBetween: 1, durationMins: 60, sessionType: 'IN_PERSON', priceCents: 9000,  color: 'rose' },
  { name: 'Anxious Dog Programme', description: '6 sessions building confidence in fearful or anxious dogs.',       sessionCount: 6, weeksBetween: 2, durationMins: 60, sessionType: 'IN_PERSON', priceCents: 78000, color: 'teal' },
  { name: 'Trick Title Prep',      description: 'Fun 5-session course toward a Novice Trick Dog title.',            sessionCount: 5, weeksBetween: 1, durationMins: 45, sessionType: 'IN_PERSON', priceCents: 47500, color: 'pink' },
]

const LIBRARY_CONTENT: Array<{ type: string; themes: Array<{ name: string; tasks: Array<{ title: string; description?: string; repetitions?: number }> }> }> = [
  {
    type: 'Foundations',
    themes: [
      { name: 'Engagement', tasks: [
        { title: 'Name game', description: 'Mark and reward every time your dog turns their head toward their name.', repetitions: 10 },
        { title: 'Check-in walks', description: 'Reward every voluntary check-in on a short walk.', repetitions: 15 },
        { title: 'Hand target', description: 'Touch nose to flat palm. Build duration.', repetitions: 10 },
      ]},
      { name: 'Calm', tasks: [
        { title: 'Settle on mat', description: 'Reward calm behaviour on a defined mat. Start with 30 seconds.', repetitions: 5 },
        { title: 'Doorway pause', description: 'Pause at thresholds. Release on a cue.', repetitions: 5 },
        { title: 'Capture relaxation', description: 'Catch your dog choosing to lie down and pay them.', repetitions: 8 },
      ]},
    ],
  },
  {
    type: 'Behaviour',
    themes: [
      { name: 'Leash Reactivity', tasks: [
        { title: 'Engage / disengage', description: 'Mark when your dog notices a trigger; reward for looking away.', repetitions: 10 },
        { title: 'Pattern games — 1-2-3', description: 'Count steps and feed on 3. Builds predictable focus.', repetitions: 8 },
      ]},
      { name: 'Resource Guarding', tasks: [
        { title: 'Trade up', description: 'Approach and trade for a higher-value reward.', repetitions: 5 },
        { title: 'Hand-feeding', description: 'Feed a portion of meals from your hand.', repetitions: 5 },
      ]},
    ],
  },
  {
    type: 'Tricks',
    themes: [
      { name: 'Novice', tasks: [
        { title: 'Spin', description: 'Lure a tight circle in each direction.', repetitions: 8 },
        { title: 'Touch a target', description: 'Nose-touch a sticky note on the wall.', repetitions: 10 },
        { title: 'Take a bow', description: 'Front-end down, rear-end up.', repetitions: 6 },
      ]},
      { name: 'Intermediate', tasks: [
        { title: 'Roll over', description: 'Lure from side-lie into a full roll.', repetitions: 5 },
        { title: 'Leg weaves', description: 'Figure-8 through your legs.', repetitions: 8 },
      ]},
    ],
  },
]

const PRODUCT_DEFS: Array<{
  name: string
  description: string
  kind: 'PHYSICAL' | 'DIGITAL'
  priceCents: number | null
  category: string
  featured: boolean
}> = [
  { name: 'Long line — 10m',         description: 'Biothane long line for recall practice.',           kind: 'PHYSICAL', priceCents: 4500, category: 'Equipment',   featured: true  },
  { name: 'High-value treat pouch',  description: 'Magnetic-close treat pouch.',                       kind: 'PHYSICAL', priceCents: 3200, category: 'Equipment',   featured: false },
  { name: 'Front-clip harness',      description: 'Y-shaped harness with chest and back attachment.',  kind: 'PHYSICAL', priceCents: 6800, category: 'Equipment',   featured: false },
  { name: 'Puppy starter kit',       description: 'Clicker, chew toy, and starter treat sampler.',     kind: 'PHYSICAL', priceCents: 5500, category: 'Bundles',     featured: true  },
  { name: 'Loose-leash mini-guide',  description: 'PDF with the four exercises from the bootcamp.',    kind: 'DIGITAL',  priceCents: 1500, category: 'Guides',      featured: false },
  { name: 'Crate training playbook', description: 'Step-by-step 14-day crate plan (PDF).',             kind: 'DIGITAL',  priceCents: 1500, category: 'Guides',      featured: false },
  { name: '1:1 video review',        description: 'Email a 2-min clip; receive a recorded review.',    kind: 'DIGITAL',  priceCents: 4500, category: 'Coaching',    featured: false },
  { name: 'Reactivity ebook',        description: 'Full 60-page guide to leash reactivity.',           kind: 'DIGITAL',  priceCents: 2800, category: 'Guides',      featured: true  },
]

const ACHIEVEMENT_DEFS: Array<{
  name: string
  description: string
  color: string
  triggerType: 'MANUAL' | 'FIRST_SESSION' | 'SESSIONS_COMPLETED' | 'HOMEWORK_STREAK_DAYS' | 'PERFECT_WEEK' | 'CLIENT_ANNIVERSARY_DAYS'
  triggerValue: number | null
}> = [
  { name: 'First session done',     description: 'Awarded after the first completed session.',          color: 'blue',    triggerType: 'FIRST_SESSION',          triggerValue: null },
  { name: '5 sessions strong',      description: 'Five sessions completed.',                            color: 'emerald', triggerType: 'SESSIONS_COMPLETED',     triggerValue: 5 },
  { name: '10 sessions strong',     description: 'Ten sessions completed.',                             color: 'amber',   triggerType: 'SESSIONS_COMPLETED',     triggerValue: 10 },
  { name: 'Perfect week',           description: 'Every homework task done in a single week.',          color: 'purple',  triggerType: 'PERFECT_WEEK',           triggerValue: null },
  { name: '7-day streak',           description: 'Homework completed seven days in a row.',             color: 'rose',    triggerType: 'HOMEWORK_STREAK_DAYS',   triggerValue: 7 },
  { name: 'Client for a month',     description: '30 days since you became a client.',                  color: 'teal',    triggerType: 'CLIENT_ANNIVERSARY_DAYS', triggerValue: 30 },
  { name: 'Trick title prep grad',  description: 'Manual award for finishing the Trick prep package.',  color: 'pink',    triggerType: 'MANUAL',                 triggerValue: null },
  { name: 'Star of the month',      description: 'Trainer-chosen highlight for the month.',             color: 'orange',  triggerType: 'MANUAL',                 triggerValue: null },
]

const ENQUIRY_MESSAGES = [
  'Hi, our 14-week pup is pulling on the lead — would love some help.',
  'Our adolescent staffy has started growling at other dogs on walks.',
  "I'd like to know if you do virtual sessions, we're in a rural area.",
  "Just adopted a rescue, she's nervous around visitors. What package suits?",
  'Reactivity on walks is escalating. Looking for someone experienced.',
  'Trying to crate train a 9-week-old lab. Tips welcome!',
  'Our older dog needs a refresher on loose-leash walking.',
  "We're moving in a month and want to prep our dog for the change.",
  'Two dogs in the household, hoping for a household harmony session.',
  'Hi! Just looking for general puppy classes — what do you offer?',
  'My dog jumps on every visitor. Help!',
  'Recall is non-existent off-leash. Where do we start?',
]

// ─── Reset ───────────────────────────────────────────────────────────────────

export type ResetResult = {
  sessions: number
  clientPackages: number
  packages: number
  libraryTypes: number
  products: number
  enquiries: number
  enquiryMessages: number
  achievements: number
  clientAchievements: number
  customFields: number
  embedForms: number
  sessionForms: number
  availabilitySlots: number
  blackouts: number
  trainingTasks: number
  taskCompletions: number
  clients: number
  dogs: number
  demoUsers: number
  templates: number
}

/**
 * Wipe every client-facing record for the given trainer. Leaves the
 * trainer's own User and TrainerProfile in place so they can sign in
 * straight after.
 *
 * Order respects FKs:
 *  • Junction / leaf rows first (task completions, achievement awards,
 *    enquiry messages, custom field values, etc.).
 *  • Then sessions (TrainingSession.clientId is SetNull — we delete
 *    sessions explicitly so client deletes don't leave orphans).
 *  • Then clients (deletes cascade to TrainingTask via the schema).
 *  • Then the per-trainer config (packages, forms, library, products,
 *    achievements, availability).
 *  • Then dogs (only the ones that were primary-for the wiped clients —
 *    additional dogs cascade with their owner profile).
 *  • Finally the synthesised demo-client User rows so re-runs don't
 *    pile up orphans.
 */
export async function resetDemoData(prisma: PrismaClient, trainerId: string): Promise<ResetResult> {
  // Capture demo-client User IDs + primary-dog IDs up front so we can
  // clean them after the profiles are gone (no cascade for either).
  const priorClients = await prisma.clientProfile.findMany({
    where: { trainerId },
    select: { id: true, dogId: true, userId: true, user: { select: { email: true } } },
  })
  const priorPrimaryDogIds = priorClients.map(c => c.dogId).filter((x): x is string => Boolean(x))
  const priorDemoUserIds = priorClients
    .filter(c => c.user?.email?.endsWith('@pupmanager.test'))
    .map(c => c.userId)

  // TaskCompletions cascade via TrainingTask.client; deleting clients
  // would cascade through, but the counts are nicer reported separately.
  const taskCompletions = await prisma.taskCompletion.deleteMany({
    where: { task: { client: { trainerId } } },
  })
  const trainingTasks = await prisma.trainingTask.deleteMany({
    where: { client: { trainerId } },
  })
  const clientAchievements = await prisma.clientAchievement.deleteMany({
    where: { client: { trainerId } },
  })
  const enquiryMessages = await prisma.enquiryMessage.deleteMany({
    where: { enquiry: { trainerId } },
  })
  const enquiries = await prisma.enquiry.deleteMany({ where: { trainerId } })

  const sessions = await prisma.trainingSession.deleteMany({ where: { trainerId } })
  const clientPackages = await prisma.clientPackage.deleteMany({
    where: { client: { trainerId } },
  })
  const clients = await prisma.clientProfile.deleteMany({ where: { trainerId } })

  const packages = await prisma.package.deleteMany({ where: { trainerId } })
  // Library deletes cascade theme → task via schema; just nuke the types.
  const libraryTypes = await prisma.libraryType.deleteMany({ where: { trainerId } })
  const products = await prisma.product.deleteMany({ where: { trainerId } })
  const achievements = await prisma.achievement.deleteMany({ where: { trainerId } })
  const customFields = await prisma.customField.deleteMany({ where: { trainerId } })
  const embedForms = await prisma.embedForm.deleteMany({ where: { trainerId } })
  const sessionForms = await prisma.sessionForm.deleteMany({ where: { trainerId } })
  const availabilitySlots = await prisma.availabilitySlot.deleteMany({ where: { trainerId } })
  const blackouts = await prisma.blackoutPeriod.deleteMany({ where: { trainerId } })
  const templates = await prisma.trainingTemplate.deleteMany({ where: { trainerId } })

  let dogs = { count: 0 }
  if (priorPrimaryDogIds.length > 0) {
    dogs = await prisma.dog.deleteMany({ where: { id: { in: priorPrimaryDogIds } } })
  }
  let demoUsers = { count: 0 }
  if (priorDemoUserIds.length > 0) {
    demoUsers = await prisma.user.deleteMany({
      where: { id: { in: priorDemoUserIds }, email: { endsWith: '@pupmanager.test' } },
    })
  }

  return {
    sessions: sessions.count,
    clientPackages: clientPackages.count,
    packages: packages.count,
    libraryTypes: libraryTypes.count,
    products: products.count,
    enquiries: enquiries.count,
    enquiryMessages: enquiryMessages.count,
    achievements: achievements.count,
    clientAchievements: clientAchievements.count,
    customFields: customFields.count,
    embedForms: embedForms.count,
    sessionForms: sessionForms.count,
    availabilitySlots: availabilitySlots.count,
    blackouts: blackouts.count,
    trainingTasks: trainingTasks.count,
    taskCompletions: taskCompletions.count,
    clients: clients.count,
    dogs: dogs.count,
    demoUsers: demoUsers.count,
    templates: templates.count,
  }
}

// ─── Seed ────────────────────────────────────────────────────────────────────

export type SeedOptions = {
  clientCount?: number
  seed?: number
}

export type SeedResult = {
  clients: number
  dogs: number
  packages: number
  clientPackages: number
  sessions: number
  trainingTasks: number
  taskCompletions: number
  libraryTypes: number
  libraryThemes: number
  libraryTasks: number
  products: number
  achievements: number
  enquiries: number
  customFields: number
  availabilitySlots: number
}

/**
 * Populate the trainer with a rich, repeatable demo dataset. Calls
 * resetDemoData first so the result is deterministic regardless of
 * pre-existing state.
 */
export async function seedDemoData(
  prisma: PrismaClient,
  trainerId: string,
  opts: SeedOptions = {},
): Promise<SeedResult> {
  const clientCount = opts.clientCount ?? 50
  const rand = rng(opts.seed ?? 0x70757070) // 'pupp'

  await resetDemoData(prisma, trainerId)

  // ─── 1. Static-ish config ──────────────────────────────────────────────────

  // Custom fields — referenced from intake form + client list.
  const customFields = await Promise.all([
    prisma.customField.create({
      data: {
        trainerId,
        label: 'Lives with kids?',
        type: 'DROPDOWN',
        appliesTo: 'OWNER',
        options: ['Yes', 'No'],
        order: 0,
      },
    }),
    prisma.customField.create({
      data: { trainerId, label: 'Favourite treat', type: 'TEXT', appliesTo: 'DOG', order: 1 },
    }),
    prisma.customField.create({
      data: {
        trainerId,
        label: 'Energy level',
        type: 'DROPDOWN',
        appliesTo: 'DOG',
        options: ['Low', 'Medium', 'High', 'Off the charts'],
        order: 2,
      },
    }),
  ])

  // Embed form for enquiries.
  const embedForm = await prisma.embedForm.create({
    data: {
      trainerId,
      title: 'Get in touch',
      description: 'Tell me about you and your dog and I will be in touch.',
      fields: [
        { key: 'phone',    required: false },
        { key: 'dogName',  required: true  },
        { key: 'dogBreed', required: false },
        { key: 'message',  required: true  },
      ],
      isActive: true,
    },
  })

  // Availability — Mon–Sat 9–17.
  const availabilitySlots = await Promise.all([1, 2, 3, 4, 5, 6].map(dow =>
    prisma.availabilitySlot.create({
      data: { trainerId, dayOfWeek: dow, startTime: '09:00', endTime: '17:00', title: 'Working hours' },
    }),
  ))

  // Packages.
  const packages = await Promise.all(PACKAGE_DEFS.map((p, i) =>
    prisma.package.create({
      data: {
        trainerId,
        name: p.name,
        description: p.description,
        sessionCount: p.sessionCount,
        weeksBetween: p.weeksBetween,
        durationMins: p.durationMins,
        sessionType: p.sessionType,
        priceCents: p.priceCents,
        color: p.color,
        order: i,
      },
    }),
  ))

  // Library tree — pre-generate type/theme IDs, three createMany calls.
  const libraryTypeRows: Array<{ id: string; trainerId: string; name: string; order: number }> = []
  const libraryThemeRows: Array<{ id: string; typeId: string; name: string; order: number }> = []
  const libraryTaskRows: Array<{ themeId: string; title: string; description?: string; repetitions?: number; order: number }> = []
  for (let ti = 0; ti < LIBRARY_CONTENT.length; ti++) {
    const t = LIBRARY_CONTENT[ti]
    const typeId = randomUUID()
    libraryTypeRows.push({ id: typeId, trainerId, name: t.type, order: ti })
    for (let thi = 0; thi < t.themes.length; thi++) {
      const th = t.themes[thi]
      const themeId = randomUUID()
      libraryThemeRows.push({ id: themeId, typeId, name: th.name, order: thi })
      for (let tki = 0; tki < th.tasks.length; tki++) {
        const tk = th.tasks[tki]
        libraryTaskRows.push({
          themeId,
          title: tk.title,
          description: tk.description,
          repetitions: tk.repetitions,
          order: tki,
        })
      }
    }
  }
  await prisma.libraryType.createMany({ data: libraryTypeRows })
  await prisma.libraryTheme.createMany({ data: libraryThemeRows })
  await prisma.libraryTask.createMany({ data: libraryTaskRows })

  // Products + achievements — one createMany each.
  await prisma.product.createMany({
    data: PRODUCT_DEFS.map((p, i) => ({
      trainerId,
      name: p.name,
      description: p.description,
      kind: p.kind,
      priceCents: p.priceCents,
      category: p.category,
      featured: p.featured,
      order: i,
    })),
  })
  await prisma.achievement.createMany({
    data: ACHIEVEMENT_DEFS.map((a, i) => ({
      trainerId,
      name: a.name,
      description: a.description,
      color: a.color,
      published: true,
      triggerType: a.triggerType,
      triggerValue: a.triggerValue,
      order: i,
    })),
  })

  // ─── 2. Clients + dogs (3 createMany calls instead of 150 awaits) ──────────

  type CreatedClient = {
    profileId: string
    dogId: string
    name: string
    email: string
    dogName: string
  }
  const createdClients: CreatedClient[] = []
  const userRows: Array<{ id: string; name: string; email: string; role: 'CLIENT'; emailVerified: Date }> = []
  const dogRows: Array<{ id: string; name: string; breed: string; weight: number; dob: Date }> = []
  const profileRows: Array<{ id: string; userId: string; trainerId: string; dogId: string; phone: string; status: string }> = []
  for (let i = 0; i < clientCount; i++) {
    const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)]
    const last = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)]
    const dogName = DOG_NAMES[Math.floor(rand() * DOG_NAMES.length)]
    const breed = BREEDS[Math.floor(rand() * BREEDS.length)]
    const weight = Math.round((rand() * 30 + 5) * 10) / 10
    const ageYears = rand() * 12 + 0.5
    const dob = new Date(Date.now() - ageYears * 365 * 24 * 3600_000)
    const userId = randomUUID()
    const dogId = randomUUID()
    const profileId = randomUUID()
    const name = `${first} ${last}`
    const email = `demo-client-${i + 1}@pupmanager.test`
    userRows.push({ id: userId, name, email, role: 'CLIENT', emailVerified: new Date() })
    dogRows.push({ id: dogId, name: dogName, breed, weight, dob })
    profileRows.push({
      id: profileId,
      userId,
      trainerId,
      dogId,
      phone: `+64 21 ${String(Math.floor(rand() * 9_000_000) + 1_000_000)}`,
      status: rand() < 0.92 ? 'ACTIVE' : 'INACTIVE',
    })
    createdClients.push({ profileId, dogId, name, email, dogName })
  }
  await prisma.user.createMany({ data: userRows })
  await prisma.dog.createMany({ data: dogRows })
  await prisma.clientProfile.createMany({ data: profileRows })

  // ─── 3. Client packages + sessions (one createMany each) ───────────────────

  const now = new Date()
  const clientPackageRows: Array<{ id: string; packageId: string; clientId: string; startDate: Date }> = []
  const sessionRows: Array<{
    trainerId: string
    clientId: string
    dogId: string
    clientPackageId: string | null
    title: string
    scheduledAt: Date
    durationMins: number
    sessionType: 'IN_PERSON' | 'VIRTUAL'
    status: 'UPCOMING' | 'COMPLETED' | 'COMMENTED'
  }> = []
  for (let i = 0; i < createdClients.length; i++) {
    const c = createdClients[i]
    const hasPackage = rand() < 0.6
    if (!hasPackage) {
      const adhoc = Math.floor(rand() * 3) + 1
      for (let s = 0; s < adhoc; s++) {
        const dayOffset = Math.floor(rand() * 42) - 21
        const start = new Date(now)
        start.setDate(start.getDate() + dayOffset)
        start.setHours(9 + Math.floor(rand() * 8), rand() < 0.5 ? 0 : 30, 0, 0)
        sessionRows.push({
          trainerId,
          clientId: c.profileId,
          dogId: c.dogId,
          clientPackageId: null,
          title: SESSION_TITLES[Math.floor(rand() * SESSION_TITLES.length)],
          scheduledAt: start,
          durationMins: 60,
          sessionType: rand() < 0.85 ? 'IN_PERSON' : 'VIRTUAL',
          status: dayOffset < 0 ? 'COMPLETED' : 'UPCOMING',
        })
      }
      continue
    }
    const pkg = packages[Math.floor(rand() * packages.length)]
    const startOffsetDays = Math.floor(rand() * 63) - 56
    const startDate = new Date(now)
    startDate.setDate(startDate.getDate() + startOffsetDays)
    startDate.setHours(0, 0, 0, 0)
    const cpId = randomUUID()
    clientPackageRows.push({ id: cpId, packageId: pkg.id, clientId: c.profileId, startDate })
    for (let s = 0; s < pkg.sessionCount; s++) {
      const sessionDate = new Date(startDate)
      sessionDate.setDate(sessionDate.getDate() + s * pkg.weeksBetween * 7)
      sessionDate.setHours(9 + Math.floor(rand() * 8), rand() < 0.5 ? 0 : 30, 0, 0)
      const isPast = sessionDate.getTime() < now.getTime()
      const status: 'UPCOMING' | 'COMPLETED' | 'COMMENTED' = isPast
        ? (rand() < 0.7 ? 'COMMENTED' : 'COMPLETED')
        : 'UPCOMING'
      sessionRows.push({
        trainerId,
        clientId: c.profileId,
        dogId: c.dogId,
        clientPackageId: cpId,
        title: pkg.name + (pkg.sessionCount > 1 ? ` · session ${s + 1}` : ''),
        scheduledAt: sessionDate,
        durationMins: pkg.durationMins,
        sessionType: pkg.sessionType,
        status,
      })
    }
  }
  await prisma.clientPackage.createMany({ data: clientPackageRows })
  await prisma.trainingSession.createMany({ data: sessionRows })

  // ─── 4. Homework tasks (last 14 days, ~65% completion) ─────────────────────

  const taskTitles = [
    'Sit / stay (3×)',
    'Recall practice (5 min)',
    'Loose-leash walk',
    'Settle on mat',
    'Touch / hand target',
    'Crate rest (15 min)',
    'Engage / disengage drill',
  ]
  const taskRows: Array<{
    id: string
    clientId: string
    dogId: string
    date: Date
    title: string
    repetitions: number
    order: number
  }> = []
  const completionRows: Array<{ taskId: string; completedAt: Date }> = []
  for (const c of createdClients) {
    if (rand() < 0.2) continue // ~80% of clients have ongoing homework
    for (let d = 13; d >= 0; d--) {
      const date = new Date(now)
      date.setDate(date.getDate() - d)
      date.setHours(0, 0, 0, 0)
      const todaysTasks = 1 + Math.floor(rand() * 2)
      for (let t = 0; t < todaysTasks; t++) {
        const taskId = randomUUID()
        taskRows.push({
          id: taskId,
          clientId: c.profileId,
          dogId: c.dogId,
          date,
          title: taskTitles[Math.floor(rand() * taskTitles.length)],
          repetitions: 5,
          order: t,
        })
        if (rand() < 0.65) {
          completionRows.push({ taskId, completedAt: new Date(date.getTime() + 11 * 3600_000) })
        }
      }
    }
  }
  await prisma.trainingTask.createMany({ data: taskRows })
  await prisma.taskCompletion.createMany({ data: completionRows })

  // ─── 5. Enquiries ──────────────────────────────────────────────────────────

  const enquiryRows: Array<{
    trainerId: string
    formId: string
    name: string
    email: string
    phone: string
    dogName: string
    dogBreed: string
    message: string
    status: 'NEW' | 'ACCEPTED' | 'DECLINED' | 'ARCHIVED'
    viewedAt: Date | null
    createdAt: Date
    updatedAt: Date
  }> = []
  for (let i = 0; i < 12; i++) {
    const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)]
    const last = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)]
    const dogName = DOG_NAMES[Math.floor(rand() * DOG_NAMES.length)]
    const ageDays = Math.floor(rand() * 21)
    const created = new Date(now.getTime() - ageDays * 24 * 3600_000)
    const roll = rand()
    const status: 'NEW' | 'ACCEPTED' | 'DECLINED' | 'ARCHIVED' =
      roll < 0.45 ? 'NEW' : roll < 0.75 ? 'ACCEPTED' : roll < 0.9 ? 'DECLINED' : 'ARCHIVED'
    enquiryRows.push({
      trainerId,
      formId: embedForm.id,
      name: `${first} ${last}`,
      email: `enquiry-${i + 1}@example.com`,
      phone: `+64 21 ${String(Math.floor(rand() * 9_000_000) + 1_000_000)}`,
      dogName,
      dogBreed: BREEDS[Math.floor(rand() * BREEDS.length)],
      message: ENQUIRY_MESSAGES[Math.floor(rand() * ENQUIRY_MESSAGES.length)],
      status,
      viewedAt: status !== 'NEW' ? created : null,
      createdAt: created,
      updatedAt: created,
    })
  }
  await prisma.enquiry.createMany({ data: enquiryRows })

  return {
    clients: createdClients.length,
    dogs: createdClients.length,
    packages: packages.length,
    clientPackages: clientPackageRows.length,
    sessions: sessionRows.length,
    trainingTasks: taskRows.length,
    taskCompletions: completionRows.length,
    libraryTypes: libraryTypeRows.length,
    libraryThemes: libraryThemeRows.length,
    libraryTasks: libraryTaskRows.length,
    products: PRODUCT_DEFS.length,
    achievements: ACHIEVEMENT_DEFS.length,
    enquiries: enquiryRows.length,
    customFields: customFields.length,
    availabilitySlots: availabilitySlots.length,
  }
}

// ─── Demo trainer lookup ─────────────────────────────────────────────────────

export const DEMO_EMAIL = 'demo@pupmanager.com'
export const DEMO_PASSWORD = 'DemoPup2026!'
export const DEMO_BUSINESS = 'Demo Dog Training'

/**
 * Find the demo trainer's TrainerProfile.id, creating the User +
 * TrainerProfile if they don't exist yet. Idempotent.
 */
export async function ensureDemoTrainer(prisma: PrismaClient): Promise<string> {
  // Lazy import so the CLI scripts can pull bcrypt without the API
  // routes paying for it on every request.
  const bcrypt = (await import('bcryptjs')).default

  const user = await prisma.user.upsert({
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

  // Refresh credentials so the documented password is always valid.
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12)
  await prisma.account.deleteMany({ where: { userId: user.id, provider: 'credentials' } })
  await prisma.account.create({
    data: { userId: user.id, type: 'credentials', provider: 'credentials', providerAccountId: hash },
  })

  // Force the demo trainer onto an ACTIVE subscription with no trial
  // window — TrainerProfile defaults to TRIALING with a 14-day window,
  // which then shows trial banners and locks features the demo is
  // supposed to show off. Re-applied on every ensure() so it can't
  // silently drift back.
  const profile = await prisma.trainerProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      businessName: DEMO_BUSINESS,
      subscriptionStatus: 'ACTIVE',
      trialEndsAt: null,
    },
    update: {
      businessName: DEMO_BUSINESS,
      subscriptionStatus: 'ACTIVE',
      trialEndsAt: null,
    },
  })

  return profile.id
}
