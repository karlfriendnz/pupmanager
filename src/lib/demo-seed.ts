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

// Align a class-run start to the weekday + time named in its scheduleNote, so
// the calendar matches the note (e.g. "Thursdays · 7:00pm" lands on a Thursday
// at 7pm) instead of whatever weekday `now + offset` happened to fall on.
// Snaps the date forward to the named weekday and sets the parsed time. Exported
// for unit testing. No weekday in the note → only the time is applied; no time →
// defaults to 18:00.
const DOW: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }
export function noteToStart(base: Date, note: string): Date {
  const d = new Date(base)
  const dm = note.toLowerCase().match(/sunday|monday|tuesday|wednesday|thursday|friday|saturday/)
  const tm = note.toLowerCase().match(/(\d{1,2}):(\d{2})\s*(am|pm)/)
  let hour = 18, min = 0
  if (tm) {
    hour = parseInt(tm[1], 10) % 12
    if (tm[3] === 'pm') hour += 12
    min = parseInt(tm[2], 10)
  }
  if (dm) {
    const diff = (DOW[dm[0]] - d.getDay() + 7) % 7
    d.setDate(d.getDate() + diff)
  }
  d.setHours(hour, min, 0, 0)
  return d
}

// ─── Trainer schedule guard ──────────────────────────────────────────────────
// A single trainer can only run one session at a time, so no two of their
// sessions may overlap. This allocator tracks every reserved [start, end)
// interval (ms) and, given a preferred start, returns the earliest free
// 15-minute-aligned slot at or after it — reserving as it goes. Preferring the
// original time (rather than packing from the top of the day) keeps each
// session on its intended day / part-of-day, so past↔future status is preserved
// and the calendar still looks naturally spread. Exported for unit testing.
export type SlotAllocator = {
  /** Reserve a fixed slot (e.g. a group class) so later placements flow around it. */
  reserve(startMs: number, durationMins: number): void
  /** Place a session at the first free slot ≥ preferred; returns the chosen start (ms). */
  place(preferredMs: number, durationMins: number): number
  /** Snapshot of reserved intervals — for assertions/tests. */
  readonly intervals: ReadonlyArray<{ start: number; end: number }>
}

export function createSlotAllocator(slotMs = 15 * 60_000): SlotAllocator {
  const occupied: Array<{ start: number; end: number }> = []
  const free = (start: number, durationMins: number): boolean => {
    const end = start + durationMins * 60_000
    for (const o of occupied) if (start < o.end && o.start < end) return false
    return true
  }
  return {
    reserve(startMs, durationMins) {
      occupied.push({ start: startMs, end: startMs + durationMins * 60_000 })
    },
    place(preferredMs, durationMins) {
      let t = Math.ceil(preferredMs / slotMs) * slotMs
      // The open future always has room, so this loop terminates well before the
      // cap; the cap just guards against a pathological all-day-duration package.
      const limit = t + 30 * 24 * 3600_000
      while (t < limit && !free(t, durationMins)) t += slotMs
      occupied.push({ start: t, end: t + durationMins * 60_000 })
      return t
    },
    get intervals() {
      return occupied.slice()
    },
  }
}

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

// Real Auckland streets across a spread of suburbs, with approximate lat/lng for
// each suburb centre. Demo clients are all Auckland-based so the map/address UI
// reads convincingly. House numbers are filled in per-client at seed time.
const AUCKLAND_STREETS: Array<{ street: string; suburb: string; postcode: string; lat: number; lng: number }> = [
  { street: 'Ponsonby Road',     suburb: 'Ponsonby',      postcode: '1011', lat: -36.8530, lng: 174.7460 },
  { street: 'Jervois Road',      suburb: 'Herne Bay',     postcode: '1011', lat: -36.8460, lng: 174.7380 },
  { street: 'Great North Road',  suburb: 'Grey Lynn',     postcode: '1021', lat: -36.8660, lng: 174.7350 },
  { street: 'Sandringham Road',  suburb: 'Sandringham',   postcode: '1025', lat: -36.8880, lng: 174.7330 },
  { street: 'Dominion Road',     suburb: 'Mount Eden',    postcode: '1024', lat: -36.8790, lng: 174.7480 },
  { street: 'Mount Eden Road',   suburb: 'Mount Eden',    postcode: '1024', lat: -36.8820, lng: 174.7640 },
  { street: 'Manukau Road',      suburb: 'Epsom',         postcode: '1023', lat: -36.8930, lng: 174.7780 },
  { street: 'Remuera Road',      suburb: 'Remuera',       postcode: '1050', lat: -36.8810, lng: 174.7990 },
  { street: 'Tamaki Drive',      suburb: 'Mission Bay',   postcode: '1071', lat: -36.8500, lng: 174.8330 },
  { street: 'St Heliers Bay Road', suburb: 'St Heliers',  postcode: '1071', lat: -36.8530, lng: 174.8560 },
  { street: 'Lake Road',         suburb: 'Takapuna',      postcode: '0622', lat: -36.7870, lng: 174.7700 },
  { street: 'Hurstmere Road',    suburb: 'Takapuna',      postcode: '0622', lat: -36.7880, lng: 174.7740 },
  { street: 'Beach Road',        suburb: 'Devonport',     postcode: '0624', lat: -36.8330, lng: 174.7960 },
  { street: 'East Coast Road',   suburb: 'Browns Bay',    postcode: '0630', lat: -36.7160, lng: 174.7480 },
  { street: 'Glenfield Road',    suburb: 'Glenfield',     postcode: '0629', lat: -36.7790, lng: 174.7250 },
  { street: 'Onewa Road',        suburb: 'Birkenhead',    postcode: '0626', lat: -36.8120, lng: 174.7290 },
  { street: 'New North Road',    suburb: 'Kingsland',     postcode: '1021', lat: -36.8740, lng: 174.7480 },
  { street: 'Richardson Road',   suburb: 'Mount Roskill', postcode: '1041', lat: -36.9090, lng: 174.7280 },
  { street: 'Stoddard Road',     suburb: 'Mount Roskill', postcode: '1041', lat: -36.9050, lng: 174.7180 },
  { street: 'Pah Road',          suburb: 'Royal Oak',     postcode: '1023', lat: -36.9100, lng: 174.7790 },
  { street: 'Great South Road',  suburb: 'Greenlane',     postcode: '1051', lat: -36.8950, lng: 174.8000 },
  { street: 'Ellerslie-Panmure Highway', suburb: 'Ellerslie', postcode: '1051', lat: -36.8980, lng: 174.8090 },
  { street: 'Ti Rakau Drive',    suburb: 'Pakuranga',     postcode: '2010', lat: -36.9050, lng: 174.8880 },
  { street: 'Pakuranga Road',    suburb: 'Howick',        postcode: '2014', lat: -36.8990, lng: 174.9300 },
  { street: 'Universal Drive',   suburb: 'Henderson',     postcode: '0610', lat: -36.8770, lng: 174.6390 },
  { street: 'Lincoln Road',      suburb: 'Henderson',     postcode: '0610', lat: -36.8650, lng: 174.6280 },
  { street: 'Don Buck Road',     suburb: 'Massey',        postcode: '0614', lat: -36.8330, lng: 174.6080 },
  { street: 'Hobsonville Road',  suburb: 'Hobsonville',   postcode: '0618', lat: -36.7920, lng: 174.6560 },
  { street: 'Great South Road',  suburb: 'Manukau',       postcode: '2104', lat: -36.9930, lng: 174.8790 },
  { street: 'Roscommon Road',    suburb: 'Manurewa',      postcode: '2102', lat: -37.0190, lng: 174.8870 },
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

type PackageDef = {
  name: string
  description: string
  sessionCount: number
  weeksBetween: number
  durationMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  priceCents: number | null
  color: string
  // Group classes — the Classes page only surfaces runs when a group package
  // exists, so the class-style packages are flagged isGroup with a capacity.
  // Only trainer/behaviourist sets use this; walkers/groomers/sitters don't run
  // classes, so their group offerings (e.g. group walks) are NOT flagged isGroup.
  isGroup?: boolean
  capacity?: number
  // ─── Client-bookable flags (drive the demo's booking surfaces) ────────────
  // clientSelfBook: 1:1 packages a client can book from their availability tab.
  // selfBookRequiresApproval: true = creates a pending BookingRequest, false =
  // books instantly. requirePayment: per-item pay-to-book override (null =
  // inherit the trainer default; only bites when the trainer can take cards).
  clientSelfBook?: boolean
  selfBookRequiresApproval?: boolean
  requirePayment?: boolean | null
  // Group-class enrolment flags: waitlist when full, rolling drop-ins, and
  // exposure on the public embed surface.
  allowWaitlist?: boolean
  allowDropIn?: boolean
  dropInPriceCents?: number
  publicEnrollment?: boolean
}

// Persona-specific sample package sets. The "Explore with sample data" flow
// picks the set(s) matching the trainer's onboarding roles so a dog walker
// doesn't land in a training-class demo.
// Booking flags are deliberately spread so every client-facing booking path is
// demo-able out of the box:
//   • Puppy Foundations — FREE group class → instant self-enrol (no payment).
//   • Reactive Rover — priced group class → the pay-to-enrol path.
//   • Virtual Coaching — FREE 1:1 → instant self-book (no approval, no payment).
//   • Loose-Leash Bootcamp — priced 1:1, require-payment → pay-to-book.
//   • Confident Adolescent — priced 1:1, require-approval → booking request.
//   • Anxious Dog Programme — priced 1:1, require-payment OFF → book now, pay later.
const TRAINER_PACKAGES: PackageDef[] = [
  { name: 'Puppy Foundations',     description: '4 sessions covering recall, sit, drop and loose-leash basics.', sessionCount: 4, weeksBetween: 1, durationMins: 60, sessionType: 'IN_PERSON', priceCents: null,  color: 'blue', isGroup: true, capacity: 8, allowWaitlist: true, publicEnrollment: true },
  { name: 'Reactive Rover',        description: '6-session behaviour plan for leash-reactive dogs.',              sessionCount: 6, weeksBetween: 1, durationMins: 60, sessionType: 'IN_PERSON', priceCents: 72000, color: 'amber', isGroup: true, capacity: 6, allowWaitlist: true, publicEnrollment: true },
  { name: 'Loose-Leash Bootcamp',  description: 'Three intensive walks focused on polite leash skills.',           sessionCount: 3, weeksBetween: 1, durationMins: 45, sessionType: 'IN_PERSON', priceCents: 28500, color: 'emerald', clientSelfBook: true, selfBookRequiresApproval: false, requirePayment: true },
  { name: 'Virtual Coaching',      description: 'A free intro Zoom for owners deciding on a training plan.',        sessionCount: 1, weeksBetween: 1, durationMins: 30, sessionType: 'VIRTUAL',   priceCents: null,  color: 'cyan', clientSelfBook: true, selfBookRequiresApproval: false },
  { name: 'Confident Adolescent',  description: '8-week programme for dogs aged 6–18 months.',                     sessionCount: 8, weeksBetween: 1, durationMins: 60, sessionType: 'IN_PERSON', priceCents: 96000, color: 'purple', clientSelfBook: true, selfBookRequiresApproval: true },
  { name: 'Drop-In Class',         description: 'Single ad-hoc class — useful for tune-ups or specific skills.',   sessionCount: 1, weeksBetween: 1, durationMins: 60, sessionType: 'IN_PERSON', priceCents: 9000,  color: 'rose', isGroup: true, capacity: 12, allowDropIn: true, dropInPriceCents: 9000 },
  { name: 'Anxious Dog Programme', description: '6 sessions building confidence in fearful or anxious dogs.',       sessionCount: 6, weeksBetween: 2, durationMins: 60, sessionType: 'IN_PERSON', priceCents: 78000, color: 'teal', clientSelfBook: true, selfBookRequiresApproval: false, requirePayment: false },
  { name: 'Trick Title Prep',      description: 'Fun 5-session course toward a Novice Trick Dog title.',            sessionCount: 5, weeksBetween: 1, durationMins: 45, sessionType: 'IN_PERSON', priceCents: 47500, color: 'pink' },
]

const BEHAVIOURIST_PACKAGES: PackageDef[] = [
  { name: 'Behaviour Assessment',   description: 'Initial 90-minute consult to assess the dog and set a plan.',     sessionCount: 1, weeksBetween: 1, durationMins: 90, sessionType: 'IN_PERSON', priceCents: 18000, color: 'purple' },
  { name: 'Reactivity Programme',   description: '6-session plan for leash-reactive or fearful dogs.',              sessionCount: 6, weeksBetween: 2, durationMins: 60, sessionType: 'IN_PERSON', priceCents: 84000, color: 'amber' },
  { name: 'Separation Anxiety Plan', description: 'Graduated absence programme with weekly check-ins.',              sessionCount: 8, weeksBetween: 1, durationMins: 45, sessionType: 'VIRTUAL',   priceCents: 96000, color: 'teal' },
  { name: 'Follow-up Session',      description: 'Single review session to adjust the behaviour plan.',             sessionCount: 1, weeksBetween: 1, durationMins: 60, sessionType: 'IN_PERSON', priceCents: 12000, color: 'cyan' },
]

const WALKER_PACKAGES: PackageDef[] = [
  { name: 'Solo Walk',        description: 'A dedicated 45-minute walk, just for your dog.',            sessionCount: 1, weeksBetween: 1, durationMins: 45, sessionType: 'IN_PERSON', priceCents: 3000, color: 'emerald' },
  { name: 'Group Walk',       description: 'A sociable 60-minute walk with a small, matched group.',    sessionCount: 1, weeksBetween: 1, durationMins: 60, sessionType: 'IN_PERSON', priceCents: 2200, color: 'blue' },
  { name: 'Pack Walk',        description: 'An off-lead adventure walk for confident, social dogs.',     sessionCount: 1, weeksBetween: 1, durationMins: 90, sessionType: 'IN_PERSON', priceCents: 3500, color: 'amber' },
  { name: 'Drop-In Visit',    description: 'A quick home visit — feed, toilet break and a cuddle.',      sessionCount: 1, weeksBetween: 1, durationMins: 30, sessionType: 'IN_PERSON', priceCents: 2000, color: 'cyan' },
  { name: 'Weekly Walk Pack', description: '5 walks a week — Monday to Friday, same time each day.',     sessionCount: 5, weeksBetween: 1, durationMins: 45, sessionType: 'IN_PERSON', priceCents: 13500, color: 'purple' },
]

const GROOMER_PACKAGES: PackageDef[] = [
  { name: 'Full Groom',       description: 'Wash, dry, clip/scissor, nails and ears — the works.',        sessionCount: 1, weeksBetween: 6, durationMins: 120, sessionType: 'IN_PERSON', priceCents: 8500, color: 'purple' },
  { name: 'Bath & Tidy',      description: 'Wash, blow-dry, brush-out and a light tidy.',                 sessionCount: 1, weeksBetween: 4, durationMins: 60,  sessionType: 'IN_PERSON', priceCents: 5000, color: 'blue' },
  { name: 'Nail Trim',        description: 'A quick nail trim and file.',                                 sessionCount: 1, weeksBetween: 4, durationMins: 20,  sessionType: 'IN_PERSON', priceCents: 2000, color: 'emerald' },
  { name: 'Puppy Intro Groom', description: 'A gentle first-groom experience for puppies.',                sessionCount: 1, weeksBetween: 4, durationMins: 45,  sessionType: 'IN_PERSON', priceCents: 4000, color: 'pink' },
  { name: 'De-shed Treatment', description: 'Deep de-shedding wash and blow-out for double coats.',        sessionCount: 1, weeksBetween: 6, durationMins: 90,  sessionType: 'IN_PERSON', priceCents: 7000, color: 'amber' },
]

const SITTER_PACKAGES: PackageDef[] = [
  { name: 'Home Visit',       description: 'A 30-minute drop-in — feed, toilet, play and company.',       sessionCount: 1, weeksBetween: 1, durationMins: 30,  sessionType: 'IN_PERSON', priceCents: 2500, color: 'emerald' },
  { name: 'Overnight Stay',   description: 'An overnight in your home so your dog keeps their routine.',   sessionCount: 1, weeksBetween: 1, durationMins: 720, sessionType: 'IN_PERSON', priceCents: 7500, color: 'blue' },
  { name: 'House Sitting',    description: 'Full house-and-dog sitting while you’re away.',                sessionCount: 1, weeksBetween: 1, durationMins: 1440, sessionType: 'IN_PERSON', priceCents: 9500, color: 'purple' },
  { name: 'Doggy Day Care',   description: 'A full day of care, walks and play at ours.',                  sessionCount: 1, weeksBetween: 1, durationMins: 480, sessionType: 'IN_PERSON', priceCents: 4500, color: 'amber' },
]

const PACKAGES_BY_ROLE: Record<string, PackageDef[]> = {
  trainer: TRAINER_PACKAGES,
  behaviourist: BEHAVIOURIST_PACKAGES,
  walker: WALKER_PACKAGES,
  groomer: GROOMER_PACKAGES,
  petsitter: SITTER_PACKAGES,
}

// The sample package set for the chosen onboarding roles: the union of the
// matching sets (deduped by name, capped), or the trainer set as a fallback
// when no roles were captured.
export function packageDefsFor(roles: string[]): PackageDef[] {
  const seen = new Set<string>()
  const out: PackageDef[] = []
  for (const role of roles) {
    for (const p of PACKAGES_BY_ROLE[role] ?? []) {
      if (!seen.has(p.name)) { seen.add(p.name); out.push(p) }
    }
  }
  return out.length ? out.slice(0, 10) : TRAINER_PACKAGES
}

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

// Map sample products to the concept-product photos used in the app mockups
// (public/concept-products) so the Products grid + client "picked for you"
// carousel show real imagery rather than blank tiles.
const PRODUCT_IMAGES: Record<string, string> = {
  'Long line — 10m': '/concept-products/leash.jpg',
  'High-value treat pouch': '/concept-products/treats.jpg',
  'Front-clip harness': '/concept-products/leash.jpg',
  'Puppy starter kit': '/concept-products/puppykit.jpg',
  'Loose-leash mini-guide': '/concept-products/clicker.jpg',
  'Crate training playbook': '/concept-products/bed.jpg',
  '1:1 video review': '/concept-products/chewtoy.jpg',
  'Reactivity ebook': '/concept-products/chewtoy.jpg',
}

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
  "Hi there — we've got a 10-month-old cocker spaniel called Maple who's an angel at home but a totally different dog on walks. She lunges and barks at other dogs and we're honestly starting to dread taking her out. We've tried a few bits from YouTube but nothing's really stuck. Would love a proper plan from someone who knows what they're doing — and to understand how many sessions we'd realistically be looking at.",
  "Hello! We adopted a rescue about six weeks ago — he's roughly 2 years old and still very unsure of new people, especially men. He'll bark and back away, and last week he nipped at a friend who reached to pat him. He's wonderful with us so we know there's a lovely dog underneath; we just need help building his confidence and keeping everyone safe in the meantime. Do you offer something for this, and would the first session be at our home?",
  "Morning — I have two dogs (a 4yo lab and a 1yo kelpie) and the younger one has started guarding toys and the couch from the older one. There've been a couple of scuffles, nothing serious yet, but I'd really like to get on top of it before it escalates. Could you let me know what a household-harmony package looks like, rough pricing, and whether you'd want to see them together or separately to start?",
]

// ─── Persona-specific sample content ──────────────────────────────────────────
// The training-flavoured constants above are the trainer set. These give the
// other trades data that reads true — a groomer's calendar should say "Full
// groom", not "Crate training". Resolved by role in seedDemoData (union of the
// matching sets, falling back to the trainer set when roles are unknown).

const SESSION_TITLES_BY_ROLE: Record<string, string[]> = {
  trainer: SESSION_TITLES,
  behaviourist: [
    'Behaviour assessment', 'Reactivity session', 'Counter-conditioning', 'Confidence building',
    'Muzzle training', 'Separation plan check-in', 'Management review', 'Desensitisation session',
    'Follow-up review', 'Household harmony session',
  ],
  walker: [
    'Solo walk', 'Group walk', 'Pack walk', 'Puppy walk', 'Adventure walk', 'Drop-in visit',
    'Lunchtime walk', 'Beach walk', 'Toilet break', 'Enrichment walk',
  ],
  groomer: [
    'Full groom', 'Bath & tidy', 'Nail trim', 'Puppy intro groom', 'De-shed treatment',
    'Wash & blow-dry', 'Face & feet tidy', 'Ear clean & tidy', 'Hand strip', 'Coat trim',
  ],
  petsitter: [
    'Home visit', 'Overnight stay', 'House sitting', 'Doggy day care', 'Feed & toilet visit',
    'Midday check-in', 'Weekend stay', 'Boarding', 'Play & company visit', 'Evening walk & feed',
  ],
}

const ENQUIRY_MESSAGES_BY_ROLE: Record<string, string[]> = {
  trainer: ENQUIRY_MESSAGES,
  behaviourist: [
    'Our adolescent staffy has started growling at other dogs on walks.',
    "Just adopted a rescue, she's nervous around visitors. What would you suggest?",
    'Reactivity on walks is escalating — looking for someone experienced.',
    'Our dog has started guarding the couch from our other dog. Can you help before it escalates?',
    ENQUIRY_MESSAGES[13], // the long rescue/fearful message
    ENQUIRY_MESSAGES[14], // the long household-harmony message
  ],
  walker: [
    "Hi, do you have space to walk our lab on weekdays while we're at work?",
    'Looking for a group walk a couple of times a week for our spaniel.',
    'Could you do a lunchtime toilet break for our new pup?',
    'We need a regular dog walker from next week — what are your rates?',
    'Our collie needs more exercise than we can give midweek. Do you do pack walks?',
  ],
  groomer: [
    'Hi, our doodle is getting matted — any grooming slots this week?',
    'How often should our cavoodle be groomed? Keen to book a full groom.',
    'Do you do nail trims as a walk-in?',
    "Our pup's never been groomed — do you do a gentle first groom for puppies?",
    'Our husky is blowing his coat everywhere — do you do a de-shed treatment?',
  ],
  petsitter: [
    "We're away for a week in the school holidays — do you do overnight stays?",
    'Looking for a house sitter for our two dogs over Christmas.',
    'Do you offer doggy day care on weekdays?',
    "Need someone to pop in twice a day to feed and walk our dog while we're at work.",
    'Do you board dogs at your place, or is it care in our home?',
  ],
}

const PRODUCTS_BY_ROLE: Record<string, typeof PRODUCT_DEFS> = {
  trainer: PRODUCT_DEFS,
  behaviourist: [
    { name: 'Reactivity ebook',       description: 'Full 60-page guide to leash reactivity.',        kind: 'DIGITAL',  priceCents: 2800, category: 'Guides',    featured: true  },
    { name: 'Management long line',    description: '5m long line for safe, low-stress management.',   kind: 'PHYSICAL', priceCents: 4200, category: 'Equipment', featured: false },
    { name: 'Muzzle sizing kit',       description: 'Try-at-home sizing kit for a comfy basket muzzle.', kind: 'PHYSICAL', priceCents: 3800, category: 'Equipment', featured: false },
    { name: 'Calming chews',           description: 'Vet-formulated calming chews for stressful days.', kind: 'PHYSICAL', priceCents: 2600, category: 'Wellbeing', featured: false },
  ],
  walker: [
    { name: 'Reflective lead',         description: 'Hi-vis lead for early-morning and evening walks.', kind: 'PHYSICAL', priceCents: 2800, category: 'Equipment', featured: true  },
    { name: 'Poop bag holder',         description: 'Clip-on dispenser with a starter roll.',          kind: 'PHYSICAL', priceCents: 1200, category: 'Equipment', featured: false },
    { name: 'Collapsible water bowl',  description: 'Pocket-sized bowl for out on the trail.',          kind: 'PHYSICAL', priceCents: 1500, category: 'Equipment', featured: false },
    { name: 'Muddy-paw towel',         description: 'Quick-dry microfibre towel for after the walk.',   kind: 'PHYSICAL', priceCents: 1900, category: 'Equipment', featured: false },
  ],
  groomer: [
    { name: 'De-shed brush',           description: 'Undercoat rake for double-coated breeds.',        kind: 'PHYSICAL', priceCents: 2400, category: 'Grooming',  featured: true  },
    { name: 'Gentle dog shampoo',      description: 'Sensitive-skin shampoo, 500ml.',                  kind: 'PHYSICAL', priceCents: 1800, category: 'Grooming',  featured: false },
    { name: 'Detangling spray',        description: 'Leave-in spray to keep coats knot-free.',         kind: 'PHYSICAL', priceCents: 1600, category: 'Grooming',  featured: false },
    { name: 'Grooming wipes',          description: 'Between-groom wipes for face, paws and bum.',      kind: 'PHYSICAL', priceCents: 900,  category: 'Grooming',  featured: false },
    { name: 'Nail file kit',           description: 'Gentle nail file for smooth, snag-free nails.',    kind: 'PHYSICAL', priceCents: 1400, category: 'Grooming',  featured: false },
  ],
  petsitter: [
    { name: 'Puzzle feeder',           description: 'Slow-feed puzzle to keep them busy while you’re out.', kind: 'PHYSICAL', priceCents: 2200, category: 'Enrichment', featured: true  },
    { name: 'Comfort blanket',         description: 'A cosy blanket that smells like home.',            kind: 'PHYSICAL', priceCents: 2600, category: 'Enrichment', featured: false },
    { name: 'Long-lasting chew',       description: 'A natural chew for settled, happy stays.',         kind: 'PHYSICAL', priceCents: 1200, category: 'Enrichment', featured: false },
    { name: 'Travel water bottle',     description: 'Leak-proof bottle with a built-in bowl.',          kind: 'PHYSICAL', priceCents: 1700, category: 'Equipment',   featured: false },
  ],
}

// Best-effort photos for the non-training products (reuse the concept-product
// pool). Missing names just render without an image.
const PRODUCT_IMAGES_EXTRA: Record<string, string> = {
  'Management long line': '/concept-products/leash.jpg',
  'Muzzle sizing kit': '/concept-products/leash.jpg',
  'Calming chews': '/concept-products/treats.jpg',
  'Reflective lead': '/concept-products/leash.jpg',
  'Poop bag holder': '/concept-products/treats.jpg',
  'Collapsible water bowl': '/concept-products/bed.jpg',
  'Muddy-paw towel': '/concept-products/bed.jpg',
  'De-shed brush': '/concept-products/chewtoy.jpg',
  'Gentle dog shampoo': '/concept-products/treats.jpg',
  'Detangling spray': '/concept-products/treats.jpg',
  'Grooming wipes': '/concept-products/treats.jpg',
  'Nail file kit': '/concept-products/clicker.jpg',
  'Puzzle feeder': '/concept-products/chewtoy.jpg',
  'Comfort blanket': '/concept-products/bed.jpg',
  'Long-lasting chew': '/concept-products/chewtoy.jpg',
  'Travel water bottle': '/concept-products/bed.jpg',
}

// Achievements everyone gets (session milestones + anniversary), plus the
// homework/trick badges that only make sense for training-style work.
const ACHIEVEMENT_DEFS_BASE = ACHIEVEMENT_DEFS.filter(a =>
  a.triggerType !== 'PERFECT_WEEK' && a.triggerType !== 'HOMEWORK_STREAK_DAYS' && a.name !== 'Trick title prep grad')
const ACHIEVEMENT_DEFS_TRAINING = ACHIEVEMENT_DEFS.filter(a =>
  a.triggerType === 'PERFECT_WEEK' || a.triggerType === 'HOMEWORK_STREAK_DAYS' || a.name === 'Trick title prep grad')

// Union of the sets matching the chosen roles (deduped), falling back to the
// trainer/base set when roles are unknown.
function contentForRoles<T>(byRole: Record<string, T[]>, roles: string[], key: (t: T) => string, fallback: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const role of roles) {
    for (const item of byRole[role] ?? []) {
      const k = key(item)
      if (!seen.has(k)) { seen.add(k); out.push(item) }
    }
  }
  return out.length ? out : fallback
}

const isTrainingRole = (roles: string[]) => roles.some(r => r === 'trainer' || r === 'behaviourist')

// The full sample-content set for a trade — session titles, enquiries, products,
// achievements and library, each resolved to the chosen roles (union, deduped,
// falling back to the trainer/base set). Exported so the persona tailoring is
// unit-testable without touching a DB.
export function sampleContentForRoles(roles: string[]) {
  const isTraining = roles.length === 0 || isTrainingRole(roles)
  return {
    sessionTitles: contentForRoles(SESSION_TITLES_BY_ROLE, roles, s => s, SESSION_TITLES),
    enquiryMessages: contentForRoles(ENQUIRY_MESSAGES_BY_ROLE, roles, s => s, ENQUIRY_MESSAGES),
    products: contentForRoles(PRODUCTS_BY_ROLE, roles, p => p.name, PRODUCT_DEFS),
    // Homework/trick achievements + the exercise library only make sense for
    // training-style work; everyone still gets the session-milestone badges.
    achievements: isTraining ? ACHIEVEMENT_DEFS : ACHIEVEMENT_DEFS_BASE,
    library: isTraining ? LIBRARY_CONTENT : [],
  }
}

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

  // Group classes — must go before packages (ClassRun.packageId FK) and
  // clients (ClassEnrollment.clientId FK). Attendance → waitlist/enrolment → run.
  await prisma.sessionAttendance.deleteMany({ where: { enrollment: { classRun: { trainerId } } } })
  await prisma.waitlistEntry.deleteMany({ where: { trainerId } })
  await prisma.classEnrollment.deleteMany({ where: { classRun: { trainerId } } })
  await prisma.classRun.deleteMany({ where: { trainerId } })

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

// ─── Clear only sample data ──────────────────────────────────────────────────

export type ClearSampleResult = {
  clients: number
  packages: number
  products: number
  achievements: number
  libraryTypes: number
  customFields: number
  embedForms: number
  enquiries: number
  availabilitySlots: number
  classRuns: number
  sessions: number
  dogs: number
  demoUsers: number
}

/**
 * Remove ONLY the trainer-loaded sample data — rows tagged `isSample`, the
 * synthetic sample clients, and everything hanging off them — leaving any real
 * data the trainer has added untouched. FK-safe order, mirroring resetDemoData
 * but scoped to sample rows / sample clients.
 */
export async function clearSampleData(prisma: PrismaClient, trainerId: string): Promise<ClearSampleResult> {
  const sampleClients = await prisma.clientProfile.findMany({
    where: { trainerId, isSample: true },
    select: { dogId: true, userId: true, user: { select: { email: true } } },
  })
  const samplePrimaryDogIds = sampleClients.map(c => c.dogId).filter((x): x is string => Boolean(x))
  const sampleUserIds = sampleClients
    .filter(c => c.user?.email?.endsWith('@pupmanager.test'))
    .map(c => c.userId)

  const sampleClientWhere = { trainerId, isSample: true } as const

  // Client-scoped leaf data (scoped to the sample clients).
  await prisma.taskCompletion.deleteMany({ where: { task: { client: sampleClientWhere } } })
  await prisma.trainingTask.deleteMany({ where: { client: sampleClientWhere } })
  await prisma.clientAchievement.deleteMany({ where: { client: sampleClientWhere } })

  // Sample enquiries + their messages.
  await prisma.enquiryMessage.deleteMany({ where: { enquiry: { trainerId, isSample: true } } })
  const enquiries = await prisma.enquiry.deleteMany({ where: { trainerId, isSample: true } })

  // Sample group classes (attendance → enrolment → run). Seed creates no
  // waitlist entries, so there are none to clear; real waitlist rows point at
  // real runs, never these.
  await prisma.sessionAttendance.deleteMany({ where: { enrollment: { classRun: { trainerId, isSample: true } } } })
  await prisma.classEnrollment.deleteMany({ where: { classRun: { trainerId, isSample: true } } })
  const classRuns = await prisma.classRun.deleteMany({ where: { trainerId, isSample: true } })

  // Sessions + package assignments for sample clients — before deleting the
  // clients (TrainingSession.clientId is SetNull, so order matters).
  const sessions = await prisma.trainingSession.deleteMany({ where: { client: sampleClientWhere } })
  await prisma.clientPackage.deleteMany({ where: { client: sampleClientWhere } })

  const clients = await prisma.clientProfile.deleteMany({ where: sampleClientWhere })

  // Sample trainer config. Packages must go after class runs — ClassRun.packageId
  // is ON DELETE Restrict. LibraryType cascades to its themes/tasks.
  const packages = await prisma.package.deleteMany({ where: { trainerId, isSample: true } })
  const libraryTypes = await prisma.libraryType.deleteMany({ where: { trainerId, isSample: true } })
  const products = await prisma.product.deleteMany({ where: { trainerId, isSample: true } })
  const achievements = await prisma.achievement.deleteMany({ where: { trainerId, isSample: true } })
  const customFields = await prisma.customField.deleteMany({ where: { trainerId, isSample: true } })
  const embedForms = await prisma.embedForm.deleteMany({ where: { trainerId, isSample: true } })
  const availabilitySlots = await prisma.availabilitySlot.deleteMany({ where: { trainerId, isSample: true } })
  // Sample session-note form (recap responses already cascaded with the sample
  // sessions; sample clients' messages + earned badges cascaded with the
  // clients).
  await prisma.sessionForm.deleteMany({ where: { trainerId, isSample: true } })

  let dogs = { count: 0 }
  if (samplePrimaryDogIds.length > 0) {
    dogs = await prisma.dog.deleteMany({ where: { id: { in: samplePrimaryDogIds } } })
  }
  let demoUsers = { count: 0 }
  if (sampleUserIds.length > 0) {
    demoUsers = await prisma.user.deleteMany({
      where: { id: { in: sampleUserIds }, email: { endsWith: '@pupmanager.test' } },
    })
  }

  return {
    clients: clients.count,
    packages: packages.count,
    products: products.count,
    achievements: achievements.count,
    libraryTypes: libraryTypes.count,
    customFields: customFields.count,
    embedForms: embedForms.count,
    enquiries: enquiries.count,
    availabilitySlots: availabilitySlots.count,
    classRuns: classRuns.count,
    sessions: sessions.count,
    dogs: dogs.count,
    demoUsers: demoUsers.count,
  }
}

// ─── Seed ────────────────────────────────────────────────────────────────────

export type SeedOptions = {
  clientCount?: number
  seed?: number
  // Onboarding roles (dog walker / trainer / groomer / …) — picks the sample
  // package set so the demo matches what the trainer actually does. Empty/absent
  // falls back to the training set.
  roles?: string[]
  // Wipe the trainer's data before seeding (admin demo account). Trainer
  // "sample data" loads pass false so real data is never touched.
  reset?: boolean
  // Tag every created row as sample so clearSampleData() can remove just these.
  markSample?: boolean
  // Run the "finalise as an established ACTIVE trainer" block (flips
  // subscription to ACTIVE, nulls the logo, completes onboarding). Right for
  // the demo account; trainers pass false so their trial/branding stay intact.
  finalize?: boolean
}

export type SeedResult = {
  classRuns: number
  classEnrolments: number
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
  earnedBadges: number
  sessionRecaps: number
  messages: number
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
  const reset = opts.reset ?? true
  // Package set tailored to the trainer's line of work (falls back to training).
  const roleList = opts.roles ?? []
  const packageDefs = packageDefsFor(roleList)
  // The rest of the sample content, tailored the same way so a groomer's demo
  // doesn't read like a dog trainer's.
  const {
    sessionTitles,
    enquiryMessages,
    products: productDefs,
    achievements: achievementDefs,
    library: libraryContent,
  } = sampleContentForRoles(roleList)
  const markSample = opts.markSample ?? false
  const finalize = opts.finalize ?? true
  // Unique token for this seed run — keeps synthetic client emails from
  // colliding with any this trainer already has (see the client loop below).
  // From randomUUID (not the deterministic RNG) so every run is distinct.
  const seedRunToken = randomUUID().slice(0, 8)

  if (reset) await resetDemoData(prisma, trainerId)

  // The trainer's own User id — the sender for trainer→client sample messages.
  const trainerUser = await prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { userId: true } })
  const trainerUserId = trainerUser?.userId ?? null

  // A few stock pup photos so sample dogs aren't all blank and the
  // photo-forward client home reads real. Local first; the rest are Unsplash
  // (cosmetic — falls back to the gradient/icon if one fails to load).
  const SAMPLE_DOG_PHOTOS = [
    '/sample-dog.jpg',
    'https://images.unsplash.com/photo-1561037404-61cd46aa615b?w=480&q=80',
    'https://images.unsplash.com/photo-1518717758536-85ae29035b6d?w=480&q=80',
    'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=480&q=80',
    'https://images.unsplash.com/photo-1537151625747-768eb6cf92b2?w=480&q=80',
    'https://images.unsplash.com/photo-1552053831-71594a27632d?w=480&q=80',
  ]

  // ─── 1. Static-ish config ──────────────────────────────────────────────────

  // Custom fields — referenced from intake form + client list.
  const customFields = await Promise.all([
    prisma.customField.create({
      data: {
        trainerId,
        isSample: markSample,
        label: 'Lives with kids?',
        type: 'DROPDOWN',
        appliesTo: 'OWNER',
        options: ['Yes', 'No'],
        order: 0,
      },
    }),
    prisma.customField.create({
      data: { trainerId, isSample: markSample, label: 'Favourite treat', type: 'TEXT', appliesTo: 'DOG', order: 1 },
    }),
    prisma.customField.create({
      data: {
        trainerId,
        isSample: markSample,
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
      isSample: markSample,
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
      data: { trainerId, isSample: markSample, dayOfWeek: dow, startTime: '09:00', endTime: '17:00', title: 'Working hours' },
    }),
  ))

  // Packages.
  const packages = await Promise.all(packageDefs.map((p, i) =>
    prisma.package.create({
      data: {
        trainerId,
        isSample: markSample,
        name: p.name,
        description: p.description,
        sessionCount: p.sessionCount,
        weeksBetween: p.weeksBetween,
        durationMins: p.durationMins,
        sessionType: p.sessionType,
        priceCents: p.priceCents,
        color: p.color,
        isGroup: p.isGroup ?? false,
        capacity: p.capacity ?? null,
        clientSelfBook: p.clientSelfBook ?? false,
        selfBookRequiresApproval: p.selfBookRequiresApproval ?? true,
        requirePayment: p.requirePayment ?? null,
        allowWaitlist: p.allowWaitlist ?? false,
        allowDropIn: p.allowDropIn ?? false,
        dropInPriceCents: p.dropInPriceCents ?? null,
        publicEnrollment: p.publicEnrollment ?? false,
        order: i,
      },
    }),
  ))

  // Library tree — pre-generate type/theme IDs, three createMany calls.
  const libraryTypeRows: Array<{ id: string; trainerId: string; isSample: boolean; name: string; order: number }> = []
  const libraryThemeRows: Array<{ id: string; typeId: string; name: string; order: number }> = []
  const libraryTaskRows: Array<{ themeId: string; title: string; description?: string; repetitions?: number; order: number }> = []
  for (let ti = 0; ti < libraryContent.length; ti++) {
    const t = libraryContent[ti]
    const typeId = randomUUID()
    libraryTypeRows.push({ id: typeId, trainerId, isSample: markSample, name: t.type, order: ti })
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
    data: productDefs.map((p, i) => ({
      trainerId,
      isSample: markSample,
      name: p.name,
      description: p.description,
      kind: p.kind,
      priceCents: p.priceCents,
      category: p.category,
      featured: p.featured,
      imageUrl: PRODUCT_IMAGES[p.name] ?? PRODUCT_IMAGES_EXTRA[p.name] ?? null,
      order: i,
    })),
  })
  // Pre-generate IDs so we can award some of these as earned badges below.
  const achievementRows = achievementDefs.map((a, i) => ({
    id: randomUUID(),
    trainerId,
    isSample: markSample,
    name: a.name,
    description: a.description,
    color: a.color,
    published: true,
    triggerType: a.triggerType,
    triggerValue: a.triggerValue,
    order: i,
  }))
  await prisma.achievement.createMany({ data: achievementRows })

  // ─── 2. Clients + dogs (3 createMany calls instead of 150 awaits) ──────────

  type CreatedClient = {
    profileId: string
    userId: string
    dogId: string
    name: string
    email: string
    dogName: string
  }
  const createdClients: CreatedClient[] = []
  const userRows: Array<{ id: string; name: string; email: string; role: 'CLIENT'; emailVerified: Date }> = []
  const dogRows: Array<{ id: string; name: string; breed: string; weight: number; dob: Date; photoUrl: string | null }> = []
  const profileRows: Array<{ id: string; userId: string; trainerId: string; isSample: boolean; dogId: string; phone: string; status: string; addressLine: string; addressLat: number; addressLng: number }> = []
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
    // Unique synthetic email per client. The per-RUN token (below) keeps it from
    // colliding with sample clients this trainer already has — so loading sample
    // data onto an account that isn't empty (e.g. the demo, or a trainer who has
    // added a few real clients) no longer trips the global User.email unique.
    // Still ends in @pupmanager.test so reset / clearSampleData spot it.
    const email = `demo-client-${seedRunToken}-${i + 1}@pupmanager.test`
    userRows.push({ id: userId, name, email, role: 'CLIENT', emailVerified: new Date() })
    // ~70% of dogs get a photo; the rest stay blank so the "add a photo" prompt
    // still demonstrates.
    const photoUrl = i % 10 < 7 ? SAMPLE_DOG_PHOTOS[i % SAMPLE_DOG_PHOTOS.length] : null
    dogRows.push({ id: dogId, name: dogName, breed, weight, dob, photoUrl })
    // Every demo client gets a real Auckland address. House number is random;
    // lat/lng jitter a touch off the suburb centre so map pins don't all stack.
    const addr = AUCKLAND_STREETS[Math.floor(rand() * AUCKLAND_STREETS.length)]
    const houseNo = Math.floor(rand() * 200) + 1
    profileRows.push({
      id: profileId,
      userId,
      trainerId,
      isSample: markSample,
      dogId,
      phone: `+64 21 ${String(Math.floor(rand() * 9_000_000) + 1_000_000)}`,
      status: rand() < 0.92 ? 'ACTIVE' : 'INACTIVE',
      addressLine: `${houseNo} ${addr.street}, ${addr.suburb}, Auckland ${addr.postcode}`,
      addressLat: addr.lat + (rand() - 0.5) * 0.006,
      addressLng: addr.lng + (rand() - 0.5) * 0.006,
    })
    createdClients.push({ profileId, userId, dogId, name, email, dogName })
  }
  await prisma.user.createMany({ data: userRows })
  await prisma.dog.createMany({ data: dogRows })
  await prisma.clientProfile.createMany({ data: profileRows })

  // ─── 3. Client packages + sessions (one createMany each) ───────────────────

  const now = new Date()

  // Schedule guard — every session below is for this one trainer, so route each
  // placement through the allocator to guarantee non-overlapping slots. Group
  // classes sit on a fixed weekday/time (per their scheduleNote) and occupy the
  // trainer too, so precompute their schedule and RESERVE those slots up front;
  // the 1:1 sessions then flow around them and around each other.
  const schedule = createSlotAllocator()
  const placeSession = (preferred: Date, durationMins: number): Date =>
    new Date(schedule.place(preferred.getTime(), durationMins))

  const groupPkgs = packages.filter(p => p.isGroup)
  const classRunDefs: { name: string; scheduleNote: string; status: 'RUNNING' | 'SCHEDULED' | 'COMPLETED'; startOffset: number; enrol: number }[] = [
    { name: 'Spring Puppy Class', scheduleNote: 'Tuesdays · 6:00pm', status: 'RUNNING', startOffset: -14, enrol: 6 },
    { name: 'Reactive Rover Group', scheduleNote: 'Thursdays · 7:00pm', status: 'SCHEDULED', startOffset: 7, enrol: 5 },
    { name: 'Foundations Group', scheduleNote: 'Saturdays · 10:00am', status: 'COMPLETED', startOffset: -63, enrol: 7 },
  ]
  // Class runs sit on a GROUP package. Only trainers/behaviourists have those —
  // walkers/groomers/sitters don't run classes, so skip entirely.
  const classPlan = groupPkgs.length > 0
    ? classRunDefs.map((def, i) => {
        const pkg = groupPkgs[i % groupPkgs.length]
        const base = new Date(now)
        base.setDate(base.getDate() + def.startOffset)
        const start = noteToStart(base, def.scheduleNote)
        const sessions: Date[] = []
        for (let s = 0; s < pkg.sessionCount; s++) {
          const d = new Date(start)
          d.setDate(d.getDate() + s * Math.max(1, pkg.weeksBetween) * 7)
          sessions.push(d)
        }
        return { def, pkg, start, sessions }
      })
    : []
  for (const cp of classPlan) for (const d of cp.sessions) schedule.reserve(d.getTime(), cp.pkg.durationMins)

  const clientPackageRows: Array<{ id: string; packageId: string; clientId: string; startDate: Date }> = []
  const sessionRows: Array<{
    id: string
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
        const preferred = new Date(now)
        preferred.setDate(preferred.getDate() + dayOffset)
        preferred.setHours(12 + Math.floor(rand() * 6), rand() < 0.5 ? 0 : 30, 0, 0)
        const scheduledAt = placeSession(preferred, 60)
        sessionRows.push({
          id: randomUUID(),
          trainerId,
          clientId: c.profileId,
          dogId: c.dogId,
          clientPackageId: null,
          title: sessionTitles[Math.floor(rand() * sessionTitles.length)],
          scheduledAt,
          durationMins: 60,
          sessionType: rand() < 0.85 ? 'IN_PERSON' : 'VIRTUAL',
          status: scheduledAt.getTime() < now.getTime() ? 'COMPLETED' : 'UPCOMING',
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
      const preferred = new Date(startDate)
      preferred.setDate(preferred.getDate() + s * pkg.weeksBetween * 7)
      preferred.setHours(12 + Math.floor(rand() * 6), rand() < 0.5 ? 0 : 30, 0, 0)
      const scheduledAt = placeSession(preferred, pkg.durationMins)
      const isPast = scheduledAt.getTime() < now.getTime()
      const status: 'UPCOMING' | 'COMPLETED' | 'COMMENTED' = isPast
        ? (rand() < 0.7 ? 'COMMENTED' : 'COMPLETED')
        : 'UPCOMING'
      sessionRows.push({
        id: randomUUID(),
        trainerId,
        clientId: c.profileId,
        dogId: c.dogId,
        clientPackageId: cpId,
        title: pkg.name + (pkg.sessionCount > 1 ? ` · session ${s + 1}` : ''),
        scheduledAt,
        durationMins: pkg.durationMins,
        sessionType: pkg.sessionType,
        status,
      })
    }
  }
  // Keep the near-term calendar busy and varied. Each filled session borrows a
  // package's name/duration/type (cycled so a day shows DIFFERENT packages),
  // assigned to a random client. Tied to sample clients, so clearSampleData
  // removes them too.
  const pushFillSession = (slot: Date, pkgIndex: number) => {
    const c = createdClients[Math.floor(rand() * createdClients.length)]
    const pkg = packages[pkgIndex % packages.length]
    const scheduledAt = placeSession(slot, pkg.durationMins)
    sessionRows.push({
      id: randomUUID(),
      trainerId,
      clientId: c.profileId,
      dogId: c.dogId,
      clientPackageId: null,
      title: pkg.name,
      scheduledAt,
      durationMins: pkg.durationMins,
      sessionType: pkg.sessionType,
      status: scheduledAt.getTime() < now.getTime() ? 'COMPLETED' : 'UPCOMING',
    })
  }

  // Guarantee at least 3 sessions on each of today, tomorrow and the day after —
  // each from a different package — so the dashboard's "today" + the next days
  // are never empty.
  for (let off = 0; off <= 2; off++) {
    for (let k = 0; k < 3; k++) {
      const day = new Date(now)
      day.setDate(day.getDate() + off)
      day.setHours(13 + k * 2, k % 2 === 0 ? 0 : 30, 0, 0) // afternoon spread
      pushFillSession(day, off * 3 + k)
    }
  }

  // Fill the rest of the next ~3 weeks of weekdays.
  for (let d = 3; d <= 21; d++) {
    const day = new Date(now)
    day.setDate(day.getDate() + d)
    const dow = day.getDay()
    if (dow === 0 || dow === 6) continue // skip weekends
    const perDay = 2 + Math.floor(rand() * 3) // 2–4 sessions per weekday
    for (let k = 0; k < perDay; k++) {
      const slot = new Date(day)
      slot.setHours(12 + Math.floor(rand() * 6), rand() < 0.5 ? 0 : 30, 0, 0)
      pushFillSession(slot, Math.floor(rand() * packages.length))
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
    isSample: boolean
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
      isSample: markSample,
      formId: embedForm.id,
      name: `${first} ${last}`,
      email: `enquiry-${i + 1}@example.com`,
      phone: `+64 21 ${String(Math.floor(rand() * 9_000_000) + 1_000_000)}`,
      dogName,
      dogBreed: BREEDS[Math.floor(rand() * BREEDS.length)],
      message: enquiryMessages[Math.floor(rand() * enquiryMessages.length)],
      status,
      viewedAt: status !== 'NEW' ? created : null,
      createdAt: created,
      updatedAt: created,
    })
  }
  await prisma.enquiry.createMany({ data: enquiryRows })

  // ─── 6. Group classes — built from the classPlan precomputed above, whose
  // (fixed) session times were already reserved in the schedule guard so the
  // 1:1 sessions flowed around them. ──────────────────────────────────────────
  const activeClassRuns = classPlan
  let classEnrolCount = 0
  for (let i = 0; i < activeClassRuns.length; i++) {
    const { def, pkg, start, sessions } = activeClassRuns[i]
    const run = await prisma.classRun.create({
      data: { trainerId, isSample: markSample, packageId: pkg.id, name: def.name, scheduleNote: def.scheduleNote, startDate: start, capacity: 8, status: def.status },
    })
    // The class's shared session series (weekly from the start) so the class
    // detail page isn't empty — past ones completed, future ones upcoming.
    const classSessionRows = sessions.map((d, s) => ({
      trainerId,
      classRunId: run.id,
      sessionIndex: s + 1,
      title: pkg.sessionCount > 1 ? `${def.name} — session ${s + 1}/${pkg.sessionCount}` : def.name,
      scheduledAt: d,
      durationMins: pkg.durationMins,
      sessionType: pkg.sessionType,
      status: d.getTime() < now.getTime() ? ('COMPLETED' as const) : ('UPCOMING' as const),
    }))
    await prisma.trainingSession.createMany({ data: classSessionRows })
    // Wrap-around offset so every class gets its full enrolment even when the
    // sandbox only has ~12 clients (the old fixed i*8 slice left later classes
    // empty). Indices stay distinct within a class (enrol < client count).
    const enrol = Math.min(def.enrol, createdClients.length)
    for (let e = 0; e < enrol; e++) {
      const c = createdClients[(i * 5 + e) % createdClients.length]
      await prisma.classEnrollment.create({
        data: { classRunId: run.id, clientId: c.profileId, dogId: c.dogId, type: 'FULL', status: def.status === 'COMPLETED' ? 'COMPLETED' : 'ENROLLED', joinedAtIndex: 0 },
      })
      classEnrolCount++
    }
  }

  // ─── 6b. Engagement: earned badges, written session recaps, messages ───────

  // Earned badges — award the first 1–3 achievements to ~60% of clients.
  const badgeRows: Array<{ clientId: string; achievementId: string; awardedBy: string; awardedAt: Date }> = []
  for (const c of createdClients) {
    if (rand() < 0.4) continue
    const earnCount = 1 + Math.floor(rand() * 3)
    for (let b = 0; b < earnCount && b < achievementRows.length; b++) {
      badgeRows.push({ clientId: c.profileId, achievementId: achievementRows[b].id, awardedBy: 'system', awardedAt: new Date(now.getTime() - Math.floor(rand() * 30) * 86400_000) })
    }
  }
  if (badgeRows.length) await prisma.clientAchievement.createMany({ data: badgeRows, skipDuplicates: true })

  // A sample session-note form + a written recap on the most recent past session
  // for ~half the clients, so the client's "last session recap" reads real.
  const RECAP_NOTES = [
    { intro: 'Great session today — really pleased with the progress.', worked: 'Loose-lead walking and focus around mild distractions.', hw: 'Five minutes of the name game daily, plus one short lead walk.' },
    { intro: 'Lovely work today!', worked: 'Settle on the mat and a calm greeting routine.', hw: 'Practise the settle twice a day for a few minutes.' },
    { intro: 'Solid session — building nicely on last week.', worked: 'Recall in the garden and impulse control at the doorway.', hw: 'Recall games in a low-distraction space, three times this week.' },
  ]
  const recapForm = await prisma.sessionForm.create({
    data: {
      trainerId,
      isSample: markSample,
      name: 'Session recap',
      introText: 'Here’s how today went.',
      questions: [
        { id: 'worked_on', type: 'LONG_TEXT', label: 'What we worked on', required: false },
        { id: 'homework', type: 'LONG_TEXT', label: 'Homework before next time', required: false },
      ],
      isActive: true,
    },
  })

  // Connect one sample class to a form: give the first group package the recap
  // form as its default, so that class's sessions inherit it (the others stay
  // form-less to show both states).
  if (groupPkgs[0]) {
    await prisma.package.update({
      where: { id: groupPkgs[0].id },
      data: { defaultSessionFormId: recapForm.id },
    })
  }
  const latestPastByClient = new Map<string, { id: string; at: number }>()
  for (const s of sessionRows) {
    if (s.status === 'UPCOMING') continue
    const at = s.scheduledAt.getTime()
    const cur = latestPastByClient.get(s.clientId)
    if (!cur || at > cur.at) latestPastByClient.set(s.clientId, { id: s.id, at })
  }
  const recapRows: Array<{ sessionId: string; formId: string; answers: Record<string, string>; introMessage: string }> = []
  let recapIdx = 0
  for (const [, sess] of latestPastByClient) {
    if (rand() < 0.5) continue
    const note = RECAP_NOTES[recapIdx % RECAP_NOTES.length]
    recapIdx++
    recapRows.push({ sessionId: sess.id, formId: recapForm.id, answers: { worked_on: note.worked, homework: note.hw }, introMessage: note.intro })
  }
  if (recapRows.length) {
    await prisma.sessionFormResponse.createMany({ data: recapRows, skipDuplicates: true })
    // These sessions now have notes.
    await prisma.trainingSession.updateMany({ where: { id: { in: recapRows.map(r => r.sessionId) } }, data: { status: 'COMMENTED' } })
  }

  // Sample message threads — trainer opener + client reply, sometimes an unread
  // trainer follow-up, for ~60% of clients.
  const MSG_OPENERS = [
    'Great session today — {dog} did really well!',
    'Lovely to see {dog} this week. Keep the homework ticking over!',
    'Nice progress with {dog} today — onwards!',
  ]
  const MSG_REPLIES = [
    'Thank you! We practised at home and it’s going well.',
    'Thanks so much — really helpful as always.',
    'Brilliant, thank you! See you next time.',
  ]
  const messageRows: Array<{ channel: 'TRAINER_CLIENT'; clientId: string; senderId: string; body: string; readAt: Date | null; createdAt: Date }> = []
  if (trainerUserId) {
    for (let i = 0; i < createdClients.length; i++) {
      const c = createdClients[i]
      if (rand() < 0.4) continue
      const base = now.getTime() - (Math.floor(rand() * 6) + 1) * 86400_000
      messageRows.push({ channel: 'TRAINER_CLIENT', clientId: c.profileId, senderId: trainerUserId, body: MSG_OPENERS[i % MSG_OPENERS.length].replace('{dog}', c.dogName), readAt: new Date(base + 3600_000), createdAt: new Date(base) })
      messageRows.push({ channel: 'TRAINER_CLIENT', clientId: c.profileId, senderId: c.userId, body: MSG_REPLIES[i % MSG_REPLIES.length], readAt: new Date(base + 2 * 3600_000), createdAt: new Date(base + 3600_000) })
      if (rand() < 0.5) {
        messageRows.push({ channel: 'TRAINER_CLIENT', clientId: c.profileId, senderId: trainerUserId, body: 'Just checking in — any questions before our next session?', readAt: null, createdAt: new Date(base + 2 * 86400_000) })
      }
    }
    if (messageRows.length) await prisma.message.createMany({ data: messageRows })
  }

  const result: SeedResult = {
    classRuns: activeClassRuns.length,
    classEnrolments: classEnrolCount,
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
    products: productDefs.length,
    achievements: achievementDefs.length,
    enquiries: enquiryRows.length,
    customFields: customFields.length,
    availabilitySlots: availabilitySlots.length,
    earnedBadges: badgeRows.length,
    sessionRecaps: recapRows.length,
    messages: messageRows.length,
  }

  // Trainers loading sample data into a live account stop here — the finalise
  // block below is demo-account-only and would clobber their real
  // subscription, branding and onboarding state.
  if (!finalize) return result

  // ─── 7. Finalise as an established, fully set-up ACTIVE trainer ─────────────
  // Active (not trialing), no logo, intake form published; every client marked
  // invited; onboarding fully complete so the checklist doesn't nag.
  await prisma.trainerProfile.update({
    where: { id: trainerId },
    data: { subscriptionStatus: 'ACTIVE', trialEndsAt: null, logoUrl: null, intakeFormPublished: true },
  })
  await prisma.clientProfile.updateMany({ where: { trainerId, invitedAt: null }, data: { invitedAt: now } })

  const progress = await prisma.trainerOnboardingProgress.upsert({
    where: { trainerId },
    create: { trainerId, welcomeShownAt: now, tourStartedAt: now, ahaReachedAt: now, checklistDismissedAt: now },
    update: { welcomeShownAt: now, tourStartedAt: now, ahaReachedAt: now, checklistDismissedAt: now },
  })
  const allSteps = await prisma.onboardingStep.findMany({ where: { publishedAt: { not: null } }, select: { key: true } })
  for (const s of allSteps) {
    await prisma.trainerOnboardingStepProgress.upsert({
      where: { progressId_stepKey: { progressId: progress.id, stepKey: s.key } },
      create: { progressId: progress.id, stepKey: s.key, completedAt: now },
      update: { completedAt: now, skippedAt: null },
    })
  }

  return result
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
      // The demo always bills against Stripe TEST mode (sandbox) so it can
      // show the full billing flow without ever taking a real charge.
      sandboxBilling: true,
    },
    update: {
      businessName: DEMO_BUSINESS,
      subscriptionStatus: 'ACTIVE',
      trialEndsAt: null,
      sandboxBilling: true,
    },
  })

  return profile.id
}
