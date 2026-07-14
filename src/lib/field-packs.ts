// Starter field packs — ready-made fields a trainer can tick on, instead of
// facing an empty field list and having to invent "Vaccination status" from
// scratch. Offered right after onboarding (and from the Fields & forms screen),
// pre-selected from the roles they already told us they work in.
//
// A pack maps to a SECTION in the intake form; its fields become CustomFields.
// Content is deliberately trainer's-eye — worth a pass from Brooke before it
// ships, since these are the questions a real trainer asks on day one.

export type PackFieldType = 'TEXT' | 'NUMBER' | 'DROPDOWN'

export interface PackField {
  /** Stable id — `${packId}:${key}` is what the client sends back. */
  key: string
  label: string
  type: PackFieldType
  /** Dropdown choices; ignored for TEXT/NUMBER. */
  options?: string[]
  appliesTo: 'OWNER' | 'DOG'
  /** Ticked by default when the pack is chosen. */
  recommended?: boolean
}

export interface FieldPack {
  id: string
  label: string
  blurb: string
  /** Section the pack's fields land in on the intake form. */
  section: string
  /** Roles (PERSONAS ids) this pack is offered to. Empty = everyone. */
  roles: string[]
  fields: PackField[]
}

export const FIELD_PACKS: FieldPack[] = [
  {
    id: 'essentials',
    label: 'The essentials',
    blurb: 'What you need for any dog, whatever the work.',
    section: 'About your dog',
    roles: [],
    fields: [
      { key: 'breed', label: 'Breed', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'age', label: 'Age', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'desexed', label: 'Desexed?', type: 'DROPDOWN', options: ['Yes', 'No', 'Not yet'], appliesTo: 'DOG', recommended: true },
      { key: 'vet', label: 'Vet clinic', type: 'TEXT', appliesTo: 'OWNER', recommended: true },
      { key: 'emergency', label: 'Emergency contact', type: 'TEXT', appliesTo: 'OWNER', recommended: true },
      { key: 'medical', label: 'Medical conditions or medication', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'howheard', label: 'How did you hear about us?', type: 'TEXT', appliesTo: 'OWNER' },
    ],
  },
  {
    id: 'training',
    label: 'Training history',
    blurb: 'Where the dog is up to, and what the owner wants out of it.',
    section: 'Training',
    roles: ['trainer', 'behaviourist'],
    fields: [
      { key: 'goals', label: 'What do you want to work on?', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'prior', label: 'Previous training', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'knows', label: 'Cues the dog already knows', type: 'TEXT', appliesTo: 'DOG' },
      { key: 'motivation', label: 'What motivates them?', type: 'DROPDOWN', options: ['Food', 'Toys', 'Praise', 'Not much yet'], appliesTo: 'DOG', recommended: true },
      { key: 'recall', label: 'Reliable off-lead recall?', type: 'DROPDOWN', options: ['Yes', 'Sometimes', 'No'], appliesTo: 'DOG' },
    ],
  },
  {
    id: 'behaviour',
    label: 'Behaviour & safety',
    blurb: 'The questions you can\'t afford to skip before a reactive or nervous dog walks in.',
    section: 'Behaviour',
    roles: ['behaviourist', 'trainer'],
    fields: [
      { key: 'triggers', label: 'Known triggers', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'reaction', label: 'What does the behaviour look like?', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'bite', label: 'Bite history', type: 'DROPDOWN', options: ['None', 'Snapped / air bite', 'Broke skin', 'Multiple incidents'], appliesTo: 'DOG', recommended: true },
      { key: 'dogs', label: 'How are they with other dogs?', type: 'DROPDOWN', options: ['Great', 'Selective', 'Reactive', 'Unknown'], appliesTo: 'DOG', recommended: true },
      { key: 'kids', label: 'How are they with children?', type: 'DROPDOWN', options: ['Great', 'Cautious', 'Not tested', 'Not safe'], appliesTo: 'DOG', recommended: true },
      { key: 'vetbehav', label: 'Seen a vet behaviourist?', type: 'DROPDOWN', options: ['No', 'Yes', 'Referred, not yet seen'], appliesTo: 'DOG' },
    ],
  },
  {
    id: 'puppy',
    label: 'Puppy',
    blurb: 'For the under-one crowd — vaccinations, crate, toilet training.',
    section: 'Puppy',
    roles: ['trainer'],
    fields: [
      { key: 'vacc', label: 'Vaccination status', type: 'DROPDOWN', options: ['Fully vaccinated', 'Partially', 'Not started'], appliesTo: 'DOG', recommended: true },
      { key: 'crate', label: 'Crate trained?', type: 'DROPDOWN', options: ['Yes', 'Working on it', 'No'], appliesTo: 'DOG', recommended: true },
      { key: 'toilet', label: 'Toilet training', type: 'DROPDOWN', options: ['Reliable', 'Accidents', 'Not started'], appliesTo: 'DOG', recommended: true },
      { key: 'sleep', label: 'Where do they sleep?', type: 'TEXT', appliesTo: 'DOG' },
      { key: 'bitework', label: 'Nipping / mouthing?', type: 'DROPDOWN', options: ['No', 'Sometimes', 'A lot'], appliesTo: 'DOG' },
    ],
  },
  {
    id: 'walking',
    label: 'Walking',
    blurb: 'Everything you need to let yourself in and get the dog out safely.',
    section: 'Walks',
    roles: ['walker'],
    fields: [
      { key: 'access', label: 'How do you get in? (key / lockbox / code)', type: 'TEXT', appliesTo: 'OWNER', recommended: true },
      { key: 'lead', label: 'Lead & harness setup', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'offlead', label: 'OK off lead?', type: 'DROPDOWN', options: ['Yes', 'Long line only', 'No'], appliesTo: 'DOG', recommended: true },
      { key: 'pulls', label: 'Pulls on lead?', type: 'DROPDOWN', options: ['No', 'A little', 'A lot'], appliesTo: 'DOG' },
      { key: 'avoid', label: 'Dogs, people or places to avoid', type: 'TEXT', appliesTo: 'DOG', recommended: true },
    ],
  },
  {
    id: 'stay',
    label: 'Boarding & day care',
    blurb: 'For dogs staying with you — routine, food, what settles them.',
    section: 'Stays',
    roles: ['petsitter'],
    fields: [
      { key: 'feeding', label: 'Feeding routine', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'meds', label: 'Medication & doses', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'alone', label: 'How long can they be left alone?', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'settle', label: 'What settles them?', type: 'TEXT', appliesTo: 'DOG' },
      { key: 'housetrained', label: 'House trained?', type: 'DROPDOWN', options: ['Yes', 'Mostly', 'No'], appliesTo: 'DOG', recommended: true },
    ],
  },
  {
    id: 'grooming',
    label: 'Grooming',
    blurb: 'Coat, handling and what happened last time.',
    section: 'Grooming',
    roles: ['groomer'],
    fields: [
      { key: 'coat', label: 'Coat type', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'lastgroom', label: 'Last groomed', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'style', label: 'Preferred style / length', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'handling', label: 'Sensitive about being handled?', type: 'TEXT', appliesTo: 'DOG', recommended: true },
      { key: 'muzzle', label: 'Needs a muzzle?', type: 'DROPDOWN', options: ['No', 'For nails only', 'Yes'], appliesTo: 'DOG' },
    ],
  },
]

export function packById(id: string): FieldPack | undefined {
  return FIELD_PACKS.find(p => p.id === id)
}

/** Packs to offer a trainer, given the roles they picked in onboarding. */
export function packsForRoles(roles: string[]): FieldPack[] {
  return FIELD_PACKS.filter(p => p.roles.length === 0 || p.roles.some(r => roles.includes(r)))
}

/** Packs ticked on by default — the essentials plus anything role-specific. */
export function recommendedPackIds(roles: string[]): string[] {
  return packsForRoles(roles).map(p => p.id)
}

/** The fields ticked by default within the offered packs. */
export function recommendedFieldKeys(roles: string[]): string[] {
  return packsForRoles(roles).flatMap(p =>
    p.fields.filter(f => f.recommended).map(f => `${p.id}:${f.key}`)
  )
}

/**
 * Resolve `packId:fieldKey` selections back to real field definitions. Unknown
 * or malformed keys are dropped rather than trusted — this is request input.
 */
export function resolveFieldKeys(keys: string[]): { pack: FieldPack; field: PackField }[] {
  const out: { pack: FieldPack; field: PackField }[] = []
  const seen = new Set<string>()
  for (const key of keys) {
    if (seen.has(key)) continue
    seen.add(key)
    const [packId, fieldKey] = key.split(':')
    const pack = packById(packId ?? '')
    const field = pack?.fields.find(f => f.key === fieldKey)
    if (pack && field) out.push({ pack, field })
  }
  return out
}
