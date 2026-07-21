// Persona-driven add-on recommendations for the onboarding wizard's "set you
// up" step. The trainer picks their role(s), then answers one simple question
// per screen (grouped by category), and we switch on the add-ons that fit.
// Pure data + functions so they can be unit-tested and reused apart from the
// (client) wizard component.

export type Persona = { id: string; label: string; icon: string }

export const PERSONAS: Persona[] = [
  { id: 'walker', label: 'Dog walker', icon: '🦮' },
  { id: 'trainer', label: 'Dog trainer', icon: '🎓' },
  { id: 'behaviourist', label: 'Behavior consulting', icon: '🧠' },
  { id: 'groomer', label: 'Groomer', icon: '✂️' },
  { id: 'petsitter', label: 'Pet sitter', icon: '🏡' },
]

// Which home view suits a persona best. Appointment-book trades (walking,
// grooming, sitting) live in their calendar, so they open on the Schedule;
// programme/progress trades (training, behaviour) get the Dashboard overview.
// Only 'dashboard' | 'schedule' are valid User.landingPage values today. This
// is a sensible default seeded at onboarding — the trainer can still change it
// in Settings. A mixed trainer+groomer leans to the Dashboard (the richer view).
export function landingViewForRoles(roles: string[]): 'dashboard' | 'schedule' {
  if (roles.some(r => r === 'trainer' || r === 'behaviourist')) return 'dashboard'
  if (roles.some(r => r === 'walker' || r === 'groomer' || r === 'petsitter')) return 'schedule'
  return 'dashboard'
}

export type WizQuestion = {
  id: string
  category: string
  q: string
  // Lucide icon key — mapped to a component in the wizard (keeps this data pure).
  icon: string
  multi: boolean
  // Persona ids this question is relevant to. Omitted = shown to everyone.
  // e.g. a dog walker never sees the "reward progress" question.
  roles?: string[]
  options: WizOption[]
}

// Package types offered, per persona. Drives the tailored "What do you offer?"
// screen — the options shown are the union across the trainer's selected roles.
export const PACKAGE_TYPES: Record<string, { id: string; label: string }[]> = {
  walker: [
    { id: 'solo-walk', label: 'Solo walks' },
    { id: 'group-walk', label: 'Group walks' },
    { id: 'pack-walk', label: 'Pack walks' },
    { id: 'drop-in', label: 'Drop-in visits' },
  ],
  trainer: [
    { id: 'private', label: '1:1 training' },
    { id: 'group-class', label: 'Group classes' },
    { id: 'puppy', label: 'Puppy courses' },
    { id: 'board-train', label: 'Board & train' },
  ],
  behaviourist: [
    { id: 'assessment', label: 'Assessments' },
    { id: 'programme', label: 'Behaviour programmes' },
    { id: 'private', label: '1:1 sessions' },
  ],
  groomer: [
    { id: 'full-groom', label: 'Full groom' },
    { id: 'bath-tidy', label: 'Bath & tidy' },
    { id: 'nail-trim', label: 'Nail trims' },
    { id: 'deshed', label: 'De-shedding' },
  ],
  petsitter: [
    { id: 'home-visit', label: 'Home visits' },
    { id: 'overnight', label: 'Overnight stays' },
    { id: 'house-sit', label: 'House sitting' },
  ],
}

// Package types that mean the business runs classes → enables the Classes feature.
export const CLASS_PACKAGE_IDS = ['group-class', 'puppy']

// Deduped package options across the selected roles (order preserved).
export function packageOptionsFor(roles: string[]): { id: string; label: string }[] {
  const seen = new Set<string>()
  const out: { id: string; label: string }[] = []
  for (const role of roles) {
    for (const p of PACKAGE_TYPES[role] ?? []) {
      if (!seen.has(p.id)) { seen.add(p.id); out.push(p) }
    }
  }
  return out
}

// An option can reveal a single-select follow-up question when it's picked
// (e.g. "Accounting software" → "Which one?"). Only the follow-up option's
// add-ons then apply, so we only switch on Xero when they actually use Xero.
export type WizFollowUp = { id: string; q: string; options: { id: string; label: string; addons: string[] }[] }
// `flags` sets TrainerProfile feature toggles (classes/notes/client app) when
// the option is picked — these gate features rather than enabling an add-on.
export type WizOption = { id: string; label: string; addons: string[]; followUp?: WizFollowUp }

// One question per screen, in order. Each maps its answer to the add-ons it
// turns on. Keep them short and single-select so each screen stays calm.
export const WIZ_QUESTIONS: WizQuestion[] = [
  {
    id: 'invoice', category: 'Billing', q: 'How would you like to invoice your clients?', icon: 'receipt', multi: false,
    options: [
      {
        id: 'software', label: 'Accounting software', addons: [],
        followUp: {
          id: 'invoiceSoftware', q: 'Which one?',
          options: [
            { id: 'stripe', label: 'Stripe', addons: [] },
            { id: 'hnry', label: 'Hnry', addons: [] },
            { id: 'xero', label: 'Xero', addons: ['xero'] },
            { id: 'quickbooks', label: 'QuickBooks', addons: [] },
            { id: 'other', label: 'Other', addons: [] },
          ],
        },
      },
      { id: 'manual', label: 'Spreadsheets or by hand', addons: [] },
      { id: 'none', label: 'Not sure yet', addons: [] },
    ],
  },
  {
    // Profiling only for now — client→trainer payments is a built-in feature
    // (Stripe Connect), not an add-on, so no options map to an add-on yet.
    id: 'payments', category: 'Billing', q: 'How would you like to take payments?', icon: 'creditCard', multi: true,
    options: [
      { id: 'bank', label: 'Bank transfer or cash', addons: [] },
      { id: 'card', label: 'Card in person', addons: [] },
      { id: 'online', label: 'Online / card payments', addons: [] },
    ],
  },
  {
    id: 'team', category: 'Your team', q: 'Would you like to add your team?', icon: 'users', multi: false,
    options: [
      { id: 'solo', label: 'Just me', addons: [] },
      { id: 'team', label: 'Yes, add my team', addons: ['timesheets'] },
    ],
  },
  {
    id: 'travel', category: 'Out & about', q: 'Where do you see your clients?', icon: 'car', multi: true,
    roles: ['walker', 'petsitter', 'groomer'],
    options: [
      { id: 'travel', label: 'I travel to them', addons: ['routeplanner'] },
      { id: 'no', label: 'They come to me', addons: [] },
    ],
  },
  {
    id: 'sell', category: 'Your shop', q: 'Would you like to sell products?', icon: 'shoppingBag', multi: false,
    options: [
      { id: 'yes', label: 'Yes, I already do', addons: ['shop'] },
      { id: 'aspire', label: 'I’d like to', addons: ['shop'] },
      { id: 'no', label: 'No', addons: [] },
    ],
  },
  {
    id: 'reward', category: 'Your clients', q: 'Would you like to celebrate your clients’ progress?', icon: 'trophy', multi: false,
    roles: ['trainer', 'behaviourist'],
    options: [
      { id: 'yes', label: 'Yes, I already do', addons: ['achievements'] },
      { id: 'aspire', label: 'I’d like to', addons: ['achievements'] },
      { id: 'no', label: 'No', addons: [] },
    ],
  },
  {
    id: 'notes', category: 'Your sessions', q: 'Would you like to record session notes?', icon: 'notebook', multi: false,
    options: [
      { id: 'yes', label: 'Yes', addons: [] },
      { id: 'no', label: 'No', addons: [] },
    ],
  },
  {
    id: 'clientapp', category: 'Client interaction', q: 'How would you like your clients to interact with the system?', icon: 'smartphone', multi: false,
    options: [
      { id: 'app', label: 'Mobile app', addons: [] },
      { id: 'email', label: 'Email', addons: [] },
      { id: 'none', label: 'No interaction', addons: [] },
    ],
  },
]

// The on/off state for the default-on "core" add-ons (Client app / Notes /
// Classes), derived from the answers. These are ON by default — 'No' turns
// them off, and Classes is inferred from whether they offer a class package.
// Persisted to /api/addons (not the profile). `packages` may be unanswered on
// the first steps, in which case Classes stays on (the default).
export function coreAddonState(answers: WizAnswers): Record<'clientapp' | 'notes' | 'classes', boolean> {
  const pkgs = answers['packages']
  const answeredPackages = Array.isArray(pkgs) && pkgs.length > 0
  return {
    // Client app on unless they chose Email or No interaction (unanswered → on).
    clientapp: answers.clientapp !== 'email' && answers.clientapp !== 'none',
    notes: answers.notes !== 'no',
    // Only flip Classes off once they've told us their packages and none are
    // class-style; before that, keep the default (on).
    classes: answeredPackages ? (pkgs as string[]).some(p => CLASS_PACKAGE_IDS.includes(p)) : true,
  }
}

// Add-ons this flow decides on (everything referenced by a question or its
// follow-up). Anything not here — e.g. the always-on free "to-do" scratchpad —
// is left untouched.
export const MANAGED_ADDON_IDS: string[] = [
  ...new Set(
    WIZ_QUESTIONS.flatMap(q =>
      q.options.flatMap(o => [...o.addons, ...(o.followUp?.options.flatMap(f => f.addons) ?? [])]),
    ),
  ),
]

export type WizAnswers = Record<string, string | string[]>

// Sensible pre-fills from the chosen roles so each question is usually a
// single confirming tap.
export function defaultAnswers(roles: string[]): WizAnswers {
  const mobile = roles.some(r => r === 'walker' || r === 'petsitter')
  const coach = roles.some(r => r === 'trainer' || r === 'behaviourist')
  const groomer = roles.includes('groomer')
  return {
    invoice: 'manual',
    payments: [],
    team: 'solo',
    travel: mobile ? ['travel'] : ['no'],
    sell: groomer ? 'yes' : 'no',
    reward: coach ? 'yes' : 'no',
    notes: 'yes',
    clientapp: 'yes',
  }
}

// Whether a question should be shown given the trainer's chosen roles.
export function questionApplies(q: WizQuestion, roles: string[]): boolean {
  return !q.roles || q.roles.some(r => roles.includes(r))
}

// The add-on ids the current answers recommend.
export function recommendedAddons(answers: WizAnswers): Set<string> {
  const s = new Set<string>()
  for (const q of WIZ_QUESTIONS) {
    const a = answers[q.id]
    for (const opt of q.options) {
      const picked = q.multi ? Array.isArray(a) && a.includes(opt.id) : a === opt.id
      if (!picked) continue
      opt.addons.forEach(id => s.add(id))
      // A revealed follow-up (e.g. which accounting software) adds its own.
      if (opt.followUp) {
        const fa = answers[opt.followUp.id]
        for (const fopt of opt.followUp.options) {
          if (fa === fopt.id) fopt.addons.forEach(id => s.add(id))
        }
      }
    }
  }
  return s
}
