/**
 * Seed one EXAMPLE intake form per line of work, so Karl can read them side by
 * side and say what's wrong before any of it becomes product.
 *
 * Review item #12: "I want a custom intake form for each type of person — a
 * trainer will have a different intake form to a groomer. Please work out what
 * these could be — keep them simple though."
 *
 * These are drafts for critique, not the final packs. They are written to the
 * LOCAL dev database only, against `trainer@demo.co.nz`.
 *
 *   npx tsx scripts/seed-role-intake-forms.ts          # local dev DB
 *   npx tsx scripts/seed-role-intake-forms.ts --clean  # remove them again
 *
 * ── What "simple" meant when writing these ─────────────────────────────────
 * Six to eight questions. A form a person fills in on a phone, one-handed,
 * while a dog pulls on the lead. The temptation with an intake form is to ask
 * everything you might ever want; the cost is landing on someone before
 * they've met you, and it is the reason most of them go unanswered.
 *
 * So each form asks only what changes what you DO on day one:
 *   • the things that stop the appointment happening (safety, handling, access)
 *   • the things you'd otherwise have to ring up and ask
 *   • one open question, because the useful answer is usually the one you
 *     didn't think to ask for
 *
 * The existing FIELD_PACKS (src/lib/field-packs.ts) were the starting point —
 * they already map questions to roles. These go further: a whole form with an
 * order and a voice, rather than a tick-list of fields.
 */
import 'dotenv/config'
import { scriptPrisma } from '@/lib/prisma-script'

const CLEAN = process.argv.includes('--clean')
const TRAINER_EMAIL = 'trainer@demo.co.nz'

// Marks the forms this script owns, so --clean can find them again and no
// hand-made form is ever deleted by accident.
const TAG = '[example]'

type Q = {
  id: string
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'DROPDOWN' | 'RADIO' | 'CHECKBOX'
  label: string
  required: boolean
  options?: string[]
}

const q = (id: string, type: Q['type'], label: string, required = false, options?: string[]): Q =>
  options ? { id, type, label, required, options } : { id, type, label, required }

interface Draft {
  role: string
  name: string
  description: string
  questions: Q[]
}

const DRAFTS: Draft[] = [
  {
    role: 'Dog trainer',
    name: `${TAG} New client — Dog trainer`,
    description:
      '<p>A few things before we start, so the first session is about your dog and not about paperwork.</p>',
    questions: [
      q('goal', 'LONG_TEXT', 'What would you most like to change?', true),
      q('tried', 'LONG_TEXT', 'What have you already tried?'),
      q('motivates', 'RADIO', 'What does your dog work hardest for?', true, ['Food', 'Toys', 'Praise', 'Not much yet']),
      q('dogs', 'RADIO', 'How are they around other dogs?', true, ['Fine', 'Depends on the dog', 'Reacts', 'Not sure yet']),
      q('bite', 'RADIO', 'Have they ever bitten or snapped at anyone?', true, ['No', 'Snapped, no contact', 'Broke skin', 'More than once']),
      q('health', 'LONG_TEXT', 'Anything health-wise I should know? (pain, medication, recent surgery)'),
      q('anything', 'LONG_TEXT', 'Anything else you want me to know?'),
    ],
  },
  {
    role: 'Behaviour consultant',
    name: `${TAG} New client — Behaviour consulting`,
    description:
      '<p>This one asks more than most. Behaviour work goes wrong when something important turns up in week three, so it is worth ten minutes now.</p>',
    questions: [
      q('behaviour', 'LONG_TEXT', 'Describe what happens, as if I were watching it', true),
      q('when', 'LONG_TEXT', 'When did it start, and has it changed since?', true),
      q('triggers', 'LONG_TEXT', 'What sets it off?', true),
      q('bite', 'RADIO', 'Bite history', true, ['None', 'Snapped, no contact', 'Broke skin', 'More than once']),
      q('kids', 'RADIO', 'How are they with children?', true, ['Fine', 'Careful around them', 'Not around children', 'Not safe']),
      q('vet', 'RADIO', 'Have they been seen by a vet about this?', true, ['No', 'Yes', 'Referred, not been yet']),
      q('meds', 'SHORT_TEXT', 'Any medication?'),
      q('worst', 'LONG_TEXT', 'What are you most worried about?'),
    ],
  },
  {
    role: 'Groomer',
    name: `${TAG} New client — Groomer`,
    description: '<p>So I know what I am working with before your dog is on the table.</p>',
    questions: [
      q('coat', 'SHORT_TEXT', 'Coat type, if you know it', true),
      q('last', 'SHORT_TEXT', 'When were they last groomed?', true),
      q('style', 'LONG_TEXT', 'How would you like them to look?', true),
      q('handling', 'CHECKBOX', 'Are they touchy about any of these?', false, ['Paws and nails', 'Face and ears', 'Tail end', 'Being lifted', 'The dryer', 'None of these']),
      q('lastgroom', 'LONG_TEXT', 'How did the last groom go?'),
      q('muzzle', 'RADIO', 'Have they needed a muzzle before?', true, ['No', 'For nails only', 'Yes']),
      q('skin', 'LONG_TEXT', 'Any skin conditions, lumps or sore spots?'),
    ],
  },
  {
    role: 'Dog walker',
    name: `${TAG} New client — Dog walker`,
    description: '<p>Mostly so I can let myself in and get your dog out safely without ringing you.</p>',
    questions: [
      q('access', 'LONG_TEXT', 'How do I get in? (key, lockbox, code, someone home)', true),
      q('kit', 'SHORT_TEXT', 'What lead and harness do they wear, and where is it kept?', true),
      q('offlead', 'RADIO', 'Can they go off lead?', true, ['Yes', 'Long line only', 'No']),
      q('pulls', 'RADIO', 'Do they pull?', true, ['No', 'A bit', 'A lot']),
      q('avoid', 'LONG_TEXT', 'Anything to avoid — dogs, people, roads, routes?'),
      q('alarm', 'SHORT_TEXT', 'Alarm code or anything else about the house?'),
      q('emergency', 'SHORT_TEXT', 'Who do I ring if I cannot reach you?', true),
    ],
  },
  {
    role: 'Pet sitter',
    name: `${TAG} New client — Pet sitter`,
    description: '<p>Your dog\'s routine, in your words — so their days with me look like their days with you.</p>',
    questions: [
      q('feeding', 'LONG_TEXT', 'What and when do they eat?', true),
      q('meds', 'LONG_TEXT', 'Any medication, and when is it due?'),
      q('alone', 'SHORT_TEXT', 'How long are they happy on their own?', true),
      q('house', 'RADIO', 'House trained?', true, ['Yes', 'Mostly', 'No']),
      q('settle', 'LONG_TEXT', 'What settles them when they are unsettled?'),
      q('sleep', 'SHORT_TEXT', 'Where do they sleep?'),
      q('vet', 'SHORT_TEXT', 'Your vet, and who I ring in an emergency', true),
    ],
  },
  {
    role: 'Puppy school',
    name: `${TAG} New client — Puppy school`,
    description: '<p>A few quick things so I can put your puppy in the right class.</p>',
    questions: [
      q('age', 'SHORT_TEXT', 'How old is your puppy, in weeks?', true),
      q('vacc', 'RADIO', 'Where are they up to with vaccinations?', true, ['All done', 'Partway through', 'Not started']),
      q('home', 'SHORT_TEXT', 'How long have you had them?', true),
      q('toilet', 'RADIO', 'How is toilet training going?', true, ['Reliable', 'Accidents', 'Not started']),
      q('nipping', 'RADIO', 'Are they nipping or mouthing?', true, ['No', 'Sometimes', 'A lot']),
      q('met', 'LONG_TEXT', 'What have they met so far — other dogs, children, traffic, visitors?'),
      q('hoping', 'LONG_TEXT', 'What are you hoping to get out of the classes?'),
    ],
  },
]

async function main() {
  const prisma = scriptPrisma()
  try {
    const host = (() => { try { return new URL(process.env.DATABASE_URL ?? '').host } catch { return '(unknown)' } })()
    if (!host.startsWith('localhost')) {
      console.error(`Refusing to run: DATABASE_URL points at ${host}, not localhost.`)
      process.exit(1)
    }
    console.log(`Database: ${host}`)

    const user = await prisma.user.findUnique({ where: { email: TRAINER_EMAIL }, select: { id: true } })
    if (!user) { console.error(`No user ${TRAINER_EMAIL} — seed the dev DB first.`); process.exit(1) }
    const profile = await prisma.trainerProfile.findFirst({ where: { userId: user.id }, select: { id: true } })
    if (!profile) { console.error('That user has no trainer profile.'); process.exit(1) }

    const existing = await prisma.form.findMany({
      where: { trainerId: profile.id, name: { startsWith: TAG } },
      select: { id: true, name: true },
    })
    if (existing.length) {
      await prisma.form.deleteMany({ where: { id: { in: existing.map(f => f.id) } } })
      console.log(`Removed ${existing.length} previous example form(s).`)
    }
    if (CLEAN) { console.log('Done — cleaned only.'); return }

    for (const d of DRAFTS) {
      await prisma.form.create({
        data: {
          trainerId: profile.id,
          name: d.name,
          description: d.description,
          // Intake only. An enquiry form is a different job (it is asking a
          // stranger whether to bother), and mixing the two would make these
          // harder to judge.
          usableAsIntake: true,
          usableAsEnquiry: false,
          questions: d.questions,
          steps: [],
        },
      })
      console.log(`  ${d.role.padEnd(22)} ${d.questions.length} questions`)
    }
    console.log(`\nCreated ${DRAFTS.length} example forms for ${TRAINER_EMAIL}.`)
    console.log('Look at them: Settings → Forms')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => { console.error(e); process.exitCode = 1 })
