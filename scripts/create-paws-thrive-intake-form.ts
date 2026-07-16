// One-off: create the Paws & Thrive "New Client Intake" session form on the
// LIVE database, transcribed from their Contact Information Form PDF.
//
// Run against PROD:
//   dotenv -e .env.livedb.local -- tsx scripts/create-paws-thrive-intake-form.ts
//
// SessionForm.questions is a flat JSON array — the model has no "section"
// concept, so the PDF's 6 sections are flattened into one ordered list (their
// order is preserved). The intro paragraph goes in introText; the liability
// waiver becomes a required agreement dropdown at the end.

import { randomUUID } from 'crypto'
import { scriptPrisma } from '../src/lib/prisma-script'

const TRAINER_EMAIL = 'hello@pawsandthrive.co.nz'
const FORM_NAME = 'New Client Intake'

type Q =
  | { id: string; type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5'; label: string; required: boolean }
  | { id: string; type: 'DROPDOWN' | 'RADIO' | 'CHECKBOX'; label: string; required: boolean; options: string[] }

const t = (label: string, required = false): Q => ({ id: randomUUID(), type: 'SHORT_TEXT', label, required })
const p = (label: string, required = false): Q => ({ id: randomUUID(), type: 'LONG_TEXT', label, required })
const radio = (label: string, options: string[], required = false): Q => ({ id: randomUUID(), type: 'RADIO', label, options, required })
const checks = (label: string, options: string[], required = false): Q => ({ id: randomUUID(), type: 'CHECKBOX', label, options, required })
const dropdown = (label: string, options: string[], required = false): Q => ({ id: randomUUID(), type: 'DROPDOWN', label, options, required })

const INTRO =
  "I'd love to get a better picture of you and your dog before we meet. This helps me customise an individualised training plan that will focus on your pain points, work to your dog's strengths and optimise our time together."

const WAIVER =
  "Being of lawful age and in consideration of being permitted to participate in the activities of dog training, the participant, on behalf of said participant and said participant's family, releases the Activity Provider of Paws & Thrive Dog Training and all associated with P&T from all manner of actions pertaining to risk associated with dog training, including but not to the exclusion of harm, injury, damage, loss and/or death of those participating in dog training, not withstanding that such damage, loss, injury, harm or death may have been caused solely or partly by the negligence of the Activity Provider of Paws & Thrive Dog Training."

const QUESTIONS: Q[] = [
  // — Section 1: Contact —
  t('Owners Name', true),
  t('Email', true),
  t('Physical Address'),
  t('Phone number', true),

  // — Section 2: Your Dog —
  t("Dog's Name", true),
  radio("Dog's Sex", ['Entire male', 'Entire female', 'Desexed male', 'Desexed female']),
  t("Dog's Breed"),
  t("Dog's Age"),
  t('How old was the dog when you brought it home?'),
  p("Are there any past disruptions in your dog's life that you know of? ie. rescue dog, foster homes, surgeries, injuries, moving cities/houses, addition of children to the household, change in relationship status?"),

  // — Section 3: Home Routines —
  p('Who lives in your household? Include first names, ages and relationship to you.'),
  p('Does your household include other pets or animals? If yes, describe these.'),
  p('Is your dog potty trained? Are there any concerns or issues around potty training? If so, include when and where accidents usually happen.'),
  p("What does your dog's usual week day look like? Include how many hours the dog is at home alone."),
  p("What does your dog's usual weekend day look like? Include details if different from a usual week day."),
  p('How often, when and where does your dog get exercised?'),
  p("Describe your dog's eating habits. Are they a grazer, a picky eater, a food snob, or a foodie? When and what do they usually eat in a day?"),
  p('Is your dog crate trained? How regularly do they use it?'),
  p('How many naps does your dog usually take a day and how long would they usually be for?'),
  radio(
    'How often does your dog use enrichment toys such as snuffle mats, kongs, lickimats, chews, puzzle toys?',
    ['Never', 'Once or twice a week', 'Daily', 'Multiple times a day', 'Every meal', 'Other'],
  ),

  // — Section 4: Behavioural Challenges —
  p('Briefly state why you are seeking training:'),
  p('What do you feel has triggered these challenges?'),
  p('Describe any previous dog training that your dog has had:'),
  p('How does your dog usually react to new people, new environments or other dogs?'),
  radio('Has your dog ever significantly harmed another dog or human?', ['Yes', 'No']),
  p('If yes to above question, please explain further:'),
  p('Has your dog ever shown any reactivity or big feelings on lead including barking, lunging and pulling toward other dogs, animals, people or things? If so, please explain:'),
  p('Has your dog ever shown any resource guarding traits eg. growling or snapping when eating or keeping other dogs or humans away from food or toys? If yes, please explain:'),

  // — Section 5: Dog's Medical Information —
  t('Veterinarian name and phone number:'),
  checks('Is your dog vaccinated for:', [
    'Distemper, Hepatitis, Parvo',
    'Canine cough',
    'Leptospirosis',
    'Unknown',
    'All of the above (everything up to date)',
    'Currently in process (puppy vax schedule)',
  ]),
  p('Please list any medical conditions or complications your dog has, including dietary requirements, sensitive digestion, prone to itchiness, or long term medication etc:'),

  // — Section 6: Moving Forward —
  p("What are your family's top three goals for your dog's training?"),
  p('What does the ideal day with your dog look like? What is the dog doing (or not doing)?'),
  checks('Paws & Thrive currently offer a Starter Package and a Thrive package for one-on-one training. Please indicate which you would prefer:', [
    'Starter Package - includes initial consult and x2 follow up training sessions - $440',
    'Thrive Package - includes initial consult and x4 follow up training sessions $580',
    'Interested in weekly Walk & Trains',
    'Interested in Classes (**prerequisite being a Starter package)',
    'Interested in Group Walks',
    'Other',
  ]),
  checks('Currently there is a waitlist for our consultation services. Please indicate which day and time you would prefer for your initial consultation and I will get back to you with availabilities ASAP.', [
    '3pm Tuesdays',
    '4.30pm Wednesdays',
    '4.30pm Fridays',
    'Other',
  ]),
  dropdown(WAIVER, ['I agree', 'I do not agree'], true),
]

async function main() {
  const prisma = scriptPrisma()
  try {
    const tp = await prisma.trainerProfile.findFirst({
      where: { user: { email: TRAINER_EMAIL } },
      select: { id: true, businessName: true, user: { select: { email: true, name: true } } },
    })
    if (!tp) {
      console.error(`❌ No trainer found for ${TRAINER_EMAIL}. Aborting — nothing written.`)
      process.exit(1)
    }
    console.log(`Trainer: ${tp.businessName ?? '(no business name)'} — ${tp.user.email} [${tp.id}]`)

    const existing = await prisma.sessionForm.findFirst({
      where: { trainerId: tp.id, name: FORM_NAME },
      select: { id: true },
    })
    if (existing) {
      console.error(`❌ A "${FORM_NAME}" form already exists for this trainer [${existing.id}]. Aborting to avoid a duplicate.`)
      process.exit(1)
    }

    const max = await prisma.sessionForm.aggregate({ where: { trainerId: tp.id }, _max: { order: true } })
    const nextOrder = (max._max.order ?? -1) + 1

    const form = await prisma.sessionForm.create({
      data: {
        trainerId: tp.id,
        name: FORM_NAME,
        description: 'Pre-training questionnaire — tell us about you and your dog before we meet.',
        introText: INTRO,
        closingText: 'Thank you! I will be in touch shortly to confirm your consultation.',
        questions: QUESTIONS as unknown as object[],
        order: nextOrder,
        isActive: true,
      },
      select: { id: true, name: true, order: true, isActive: true },
    })
    console.log(`✅ Created session form "${form.name}" [${form.id}] with ${QUESTIONS.length} questions (order ${form.order}, active ${form.isActive}).`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
