// Seed a demo puppy school into the LOCAL dev DB so the week board has data.
// Run: npx dotenv -e .env.development.local -- tsx scripts/seed-puppy-school.ts
//
// Creates (idempotent — re-running replaces the demo):
//  - enables the Puppy School add-on for the dev trainer (trainer@demo.co.nz)
//  - a "Waggy Tails Puppy School (demo)" with Morning + Afternoon parts, Mon–Fri
//  - this week's sessions
//  - 8 demo dogs booked across those sessions so cells show occupancy
import { scriptPrisma } from '../src/lib/prisma-script'
import { ADDONS } from '../src/lib/pricing'
import { replacePackageSlots } from '../src/lib/package-slots'
import { createClassRunIn } from '../src/lib/class-runs'

const prisma = scriptPrisma()
const PKG_NAME = 'Waggy Tails Doggy Daycare (demo)'
// Dog + the person who brings them. The owners used to be seeded as
// "Bailey's Owner", "Max's Owner" … which then showed up verbatim wherever the
// app prints a client's name — a roster of "<Dog>'s Owner" rows reads like the
// app failed to find the real name and fell back to a derived label. It isn't a
// fallback; nothing in src/ builds a name like that. It was just the seed. Real
// names here, so demo screens look like a real client list.
const CAST: { dog: string; owner: string }[] = [
  { dog: 'Bailey', owner: 'Hannah Whitfield' },
  { dog: 'Max',    owner: 'Tom Ellery' },
  { dog: 'Coco',   owner: 'Priya Raman' },
  { dog: 'Rosie',  owner: 'Grace Lomu' },
  { dog: 'Ziggy',  owner: 'Danny Okafor' },
  { dog: 'Bandit', owner: 'Marcus Reid' },
  { dog: 'Nala',   owner: 'Emily Chen' },
  { dog: 'Milo',   owner: 'Josh Tanumafili' },
]
const DOGS = CAST.map(c => c.dog)

function mondayISO(): string {
  const n = new Date()
  const dow = (n.getDay() + 6) % 7 // Mon = 0
  const mon = new Date(n)
  mon.setDate(n.getDate() - dow)
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
}

async function main() {
  const email = process.argv[2] || 'trainer@demo.co.nz'
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!user) throw new Error(`Trainer ${email} not found in the LOCAL dev DB — this script never touches prod.`)
  const trainer = await prisma.trainerProfile.findFirst({ where: { userId: user.id }, select: { id: true } })
  if (!trainer) throw new Error(`No trainer profile for ${email} in the local dev DB.`)
  const trainerId = trainer.id

  // ── clean up any prior run of this seed ──────────────────────────────────
  const seedUsers = await prisma.user.findMany({ where: { email: { startsWith: 'puppyseed' } }, select: { id: true } })
  const seedUserIds = seedUsers.map(u => u.id)
  const seedProfiles = await prisma.clientProfile.findMany({ where: { userId: { in: seedUserIds } }, select: { id: true } })
  const seedProfileIds = seedProfiles.map(p => p.id)
  if (seedProfileIds.length) {
    await prisma.classEnrollment.deleteMany({ where: { clientId: { in: seedProfileIds } } })
    await prisma.clientProfile.updateMany({ where: { id: { in: seedProfileIds } }, data: { dogId: null } })
    await prisma.dog.deleteMany({ where: { clientProfileId: { in: seedProfileIds } } })
    await prisma.clientProfile.deleteMany({ where: { id: { in: seedProfileIds } } })
  }
  if (seedUserIds.length) await prisma.user.deleteMany({ where: { id: { in: seedUserIds } } })
  // Any prior demo school (old or new name).
  const priors = await prisma.package.findMany({ where: { trainerId, isPuppySchool: true, name: { contains: '(demo)' } }, select: { id: true } })
  for (const prior of priors) {
    await prisma.classRun.deleteMany({ where: { packageId: prior.id } }) // cascades sessions + enrolments
    await prisma.packageSessionSlot.deleteMany({ where: { packageId: prior.id } })
    await prisma.package.delete({ where: { id: prior.id } })
  }

  // ── 1. enable the add-on ─────────────────────────────────────────────────
  const def = ADDONS.find(a => a.id === 'puppyschool')!
  await prisma.billingItem.upsert({
    where: { id: 'puppyschool' },
    update: {},
    create: { id: 'puppyschool', kind: 'ADDON', name: def.name, description: def.description, priceMonthly: def.price.NZD, sortOrder: ADDONS.findIndex(a => a.id === 'puppyschool') + 1 },
  })
  await prisma.trainerAddon.upsert({
    where: { trainerId_itemId: { trainerId, itemId: 'puppyschool' } },
    update: { active: true },
    create: { trainerId, itemId: 'puppyschool', active: true },
  })

  // ── 2. the school + day-part slots ───────────────────────────────────────
  const startDate = mondayISO()
  const pkg = await prisma.package.create({
    data: {
      trainerId, name: PKG_NAME, isGroup: true, isPuppySchool: true,
      sessionCount: 0, weeksBetween: 1, durationMins: 180, capacity: 8,
      allowWaitlist: true, clientSelfBook: true, selfBookRequiresApproval: false,
    },
  })
  const days = [1, 2, 3, 4, 5] // Mon–Fri
  const parts = [
    { start: '09:00', end: '12:00', price: 1800 }, // Morning
    { start: '13:00', end: '16:00', price: 1800 }, // Afternoon
  ]
  const slots = parts.flatMap(p => days.map(day => ({
    day, startTime: p.start, endTime: p.end, priceCents: p.price, capacity: 8, startDate, recurrenceRule: 'FREQ=WEEKLY',
  })))
  await replacePackageSlots(prisma, pkg.id, trainerId, slots)

  // ── 3. schedule the run + sessions ───────────────────────────────────────
  const run = await createClassRunIn(prisma, { trainerId, packageId: pkg.id, name: PKG_NAME, startDate: new Date(`${startDate}T00:00:00`), capacity: 8, location: 'The Barn' })

  const weekStart = new Date(`${startDate}T00:00:00`)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)
  const sessions = await prisma.trainingSession.findMany({
    where: { classRunId: run.id, scheduledAt: { gte: weekStart, lt: weekEnd } },
    select: { id: true }, orderBy: { scheduledAt: 'asc' },
  })

  // ── 4. demo dogs + bookings ──────────────────────────────────────────────
  let bookings = 0
  for (let i = 0; i < DOGS.length; i++) {
    const u = await prisma.user.create({ data: { email: `puppyseed${i}@demo.local`, name: CAST[i].owner, role: 'CLIENT' } })
    const profile = await prisma.clientProfile.create({ data: { userId: u.id, trainerId, status: 'ACTIVE', phone: `021 555 0${i}${i}0` } })
    const dog = await prisma.dog.create({ data: { name: DOGS[i], clientProfileId: profile.id } })
    await prisma.clientProfile.update({ where: { id: profile.id }, data: { dogId: dog.id } })
    // Book each dog into a spread of this week's sessions (drop-in).
    const chosen = sessions.filter((_, idx) => (idx + i) % 3 === 0)
    for (const s of chosen) {
      await prisma.classEnrollment.create({
        data: { classRunId: run.id, clientId: profile.id, dogId: dog.id, type: 'DROP_IN', status: 'ENROLLED', dropInSessionId: s.id, source: 'TRAINER' },
      }).catch(() => {})
      bookings++
    }
  }

  console.log(`✓ "${PKG_NAME}" created — ${sessions.length} sessions this week, ${bookings} bookings across ${DOGS.length} dogs.`)
  console.log(`  Open http://localhost:7777/doggy-daycare (log in as ${email}).`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
