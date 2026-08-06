// What one flow step SAYS it does, in a trainer's words.
//
// The builder is a vertical list of rows (Karl picked it over a drag-canvas —
// the app is used on a phone), and each row is two lines:
//
//     Send form: Pre-groom questions      ← what
//       wait for their answers            ← when
//
// Both lines come from here rather than from JSX, for three reasons. The first
// is that they are the only description of a step a trainer ever reads, so they
// have to be right — and a pure function is the only thing you can put a test
// on. The second is that they are derived from FOUR different columns (`kind`,
// `actor`, `blocking`, and whichever of `trigger`/`direction`/`offsetMinutes`
// the anchor uses), and doing that inline is how a screen ends up saying "0 min
// before" about a step that fires the moment somebody enquires. The third is
// that nothing else in this app is allowed to invent a second way of phrasing
// the same fact.
//
// PURE. No Prisma, no React — the builder imports it into the browser bundle.
import {
  flowAnchorFor,
  flowTriggerFor,
  isClockRunnable,
  type FlowAnchor,
} from './flow-anchors'
import {
  flowStepConfigProblem,
  safeFlowStepPayload,
  uploadSpecFor,
  type FlowStepActor,
  type FlowStepKind,
  type FlowTrigger,
} from './comms-flow-steps'

/** Everything a row needs to describe itself. Deliberately the shape the API
 *  already returns, so the builder passes a step straight through. */
export interface SummarisableStep {
  kind: FlowStepKind
  actor: FlowStepActor
  trigger?: FlowTrigger | null
  direction: string
  offsetMinutes: number
  blocking: boolean
  channels: string[]
  title: string | null
  body: string | null
  payload?: unknown
}

/**
 * The names of the things a step POINTS AT.
 *
 * A step stores `{ formId: "abc" }`; a row has to read "Pre-groom questions".
 * The ids are resolved by whoever is rendering (the builder holds the trainer's
 * forms, homework library and offerings already) and handed in — this module
 * stays pure and never fetches. A missing name reads as "not chosen yet", which
 * is also what an unconfigured step reads as, and that is correct: from the
 * trainer's side a deleted form and an unpicked one are the same problem.
 */
export interface FlowStepNames {
  /** Form id → name. */
  forms?: Record<string, string | undefined>
  /** LibraryTask id → title. */
  tasks?: Record<string, string | undefined>
  /** Package id → name. */
  offerings?: Record<string, string | undefined>
}

/** Plain names for the channels, in the order they were picked. */
const CHANNEL_WORD: Record<string, string> = {
  PUSH: 'push',
  EMAIL: 'email',
  IN_APP: 'in-app',
}

function channelWords(channels: string[]): string {
  const words = channels.map(c => CHANNEL_WORD[c] ?? c.toLowerCase()).filter(Boolean)
  if (words.length === 0) return 'nothing'
  if (words.length === 1) return words[0]
  return `${words.slice(0, -1).join(', ')} + ${words[words.length - 1]}`
}

/** The offsets the editor offers, as words. Anything else is rounded. */
const OFFSET_LABELS: { min: number; label: string }[] = [
  { min: 15, label: '15 minutes' },
  { min: 30, label: '30 minutes' },
  { min: 60, label: '1 hour' },
  { min: 120, label: '2 hours' },
  { min: 1440, label: '1 day' },
  { min: 2880, label: '2 days' },
  { min: 4320, label: '3 days' },
  { min: 10080, label: '1 week' },
]

export function offsetLabel(min: number): string {
  const preset = OFFSET_LABELS.find(o => o.min === min)
  if (preset) return preset.label
  if (min < 60) return `${min} min`
  if (min < 1440) return `${Math.round(min / 60)} hr`
  return `${Math.round(min / 1440)} days`
}

/**
 * WHEN this step fires, in words.
 *
 * `index` is the step's position in its flow, and it only matters for a
 * person-anchored journey: the first step fires off the trigger, and every one
 * after it is unlocked by the step before finishing. Saying "as soon as they
 * enquire" against step four would be a lie — nothing in a journey fires on a
 * clock.
 */
export function flowStepWhenText(step: SummarisableStep, index = 0): string {
  const anchor: FlowAnchor = flowAnchorFor(step)

  if (anchor === 'PERSON') {
    if (index > 0) return 'Once the step before is done'
    switch (flowTriggerFor(step)) {
      case 'ON_ENQUIRY_SUBMITTED':
        return 'As soon as they enquire'
      case 'ON_SIGNUP':
        return 'When they sign up'
      case 'ON_BOOKING':
        return 'When they book'
      default:
        return 'At the start'
    }
  }

  if (anchor === 'PURCHASE') {
    if (step.direction === 'BEFORE_PERIOD_END') return `${offsetLabel(step.offsetMinutes)} before it renews`
    return step.offsetMinutes === 0 ? 'When they join' : `${offsetLabel(step.offsetMinutes)} after they join`
  }

  // SESSION.
  //
  // "During" is a window, not an offset: it happens while the session is
  // actually running, so there is no number to say. Answered before the zero
  // case below precisely so a stale offsetMinutes left over from when the step
  // was a "1 day before" reminder cannot put a lead time on it.
  if (step.direction === 'DURING_SESSION') return 'While the session is on'

  // Zero is not "0 min before" — it is the moment itself, and a step added from
  // the picker starts at zero, so this is the common case rather than the odd
  // one.
  if (step.offsetMinutes === 0) {
    return step.direction === 'BEFORE_SESSION' ? 'When the session starts' : 'When the session ends'
  }
  return `${offsetLabel(step.offsetMinutes)} ${step.direction === 'BEFORE_SESSION' ? 'before' : 'after'}`
}

/**
 * WHAT this step does, in words — the row's first line.
 *
 * Phrased from the trainer's chair throughout: their client is "they", and a
 * step the trainer has to do themselves says "You". A trainer scanning a flow
 * is asking "whose move is it", and that is the question this line answers
 * before any of the detail.
 */
export function flowStepWhatText(step: SummarisableStep, names: FlowStepNames = {}): string {
  const kind = step.kind
  switch (kind) {
    case 'MESSAGE': {
      const what = `Send ${channelWords(step.channels)}`
      return step.title?.trim() ? `${what}: ${step.title.trim()}` : what
    }
    case 'FORM': {
      const formId = safeFlowStepPayload('FORM', step.payload).payload.formId
      const name = formId ? names.forms?.[formId] : undefined
      // NOT "Send form". This step sends nothing — it puts the form in front of
      // them (see stepSendsNotification); the trainer adds a message step
      // beside it if they want one, and the row must not claim otherwise.
      return `Ask them to fill in: ${name ?? (formId ? 'a form that no longer exists' : 'not chosen yet')}`
    }
    case 'UPLOAD': {
      const spec = uploadSpecFor(safeFlowStepPayload('UPLOAD', step.payload).payload)
      const ask = spec.label?.trim() || (spec.target === 'DOG_PHOTO' ? 'a photo of their dog' : 'a file')
      return `Ask for: ${ask}`
    }
    case 'TASK': {
      const task = safeFlowStepPayload('TASK', step.payload).payload
      const name = task.libraryTaskId
        ? names.tasks?.[task.libraryTaskId] ?? 'a task that no longer exists'
        : task.title?.trim()
      return `Give homework: ${name || 'not chosen yet'}`
    }
    case 'ACCOUNT': {
      const method = safeFlowStepPayload('ACCOUNT', step.payload).payload.method
      return method === 'MAGIC_LINK' ? 'They get a sign-in link' : 'They set up their login'
    }
    case 'CHOOSE_OFFERING': {
      const p = safeFlowStepPayload('CHOOSE_OFFERING', step.payload).payload
      const picked = p.packageIds?.length ?? 0
      const scope = picked ? `${picked} you picked` : 'anything you have published'
      return `They choose what to book — from ${scope}`
    }
    case 'APPROVAL': {
      const p = safeFlowStepPayload('APPROVAL', step.payload).payload
      switch (p.decides ?? 'BOOKING_TIME') {
        case 'BOOKING_TIME':
          return p.allowReschedule === false ? 'You accept the time' : 'You accept or move the time'
        case 'ENROLMENT':
          return 'You accept them onto it'
        case 'UPLOAD':
          return 'You check what they sent'
        case 'FORM':
          return 'You read their answers'
      }
      return 'You approve it'
    }
    default: {
      const unhandled: never = kind
      return `Unknown step (${String(unhandled)})`
    }
  }
}

/**
 * What "wait for this" means for THIS kind — the second line of a blocking row.
 *
 * `blocking` is a checkbox in the database and must never read as one on the
 * screen. "Blocking ☑" tells a trainer nothing; "wait for their answers" tells
 * them the next step will not happen until the client has filled the form in,
 * which is the entire behaviour.
 */
export function flowStepWaitText(step: SummarisableStep): string | null {
  if (!step.blocking) return null
  switch (step.kind) {
    case 'FORM':
      return 'wait for their answers'
    case 'UPLOAD':
      return 'wait for the upload'
    case 'TASK':
      return 'wait until it is ticked off'
    case 'ACCOUNT':
      return 'wait until they have a login'
    case 'CHOOSE_OFFERING':
      return 'wait until they have chosen'
    case 'APPROVAL':
      return step.actor === 'TRAINER' ? 'wait for you' : 'wait for the decision'
    case 'MESSAGE':
      return 'wait here'
    default:
      return 'wait here'
  }
}

// ─── The step-type picker ───────────────────────────────────────────────────

/**
 * The seven kinds, each explained in one line a trainer can act on.
 *
 * "Add step" opens a FULL SCREEN (AGENTS.md: more than ~3 choices takes the
 * whole screen), and a full screen is only worth the space if every option
 * explains itself. These are the explanations. `actor` is the side that MOVES —
 * it decides which half of the picker a kind appears under, and what the row
 * ends up chipped with.
 */
export interface FlowStepKindOption {
  kind: FlowStepKind
  label: string
  hint: string
  actor: FlowStepActor
}

export const FLOW_STEP_KIND_CATALOG: FlowStepKindOption[] = [
  {
    kind: 'MESSAGE',
    label: 'Send a message',
    hint: 'A push, an email, or both — whatever you want to say, whenever you want to say it.',
    actor: 'CLIENT',
  },
  {
    kind: 'FORM',
    label: 'Ask them to fill in a form',
    hint: 'One of your own forms. You can hold the rest of the flow until it comes back.',
    actor: 'CLIENT',
  },
  {
    kind: 'UPLOAD',
    label: 'Ask for a photo or a file',
    hint: 'A picture of their dog, a vet letter, a vaccination card — it lands with the answer.',
    actor: 'CLIENT',
  },
  {
    kind: 'TASK',
    label: 'Give them homework',
    hint: 'Something to practise, from your library or typed here. It shows up in their homework.',
    actor: 'CLIENT',
  },
  {
    kind: 'ACCOUNT',
    label: 'Have them set up a login',
    hint: 'Turns an enquiry into a client of yours — they pick a password and land in the app.',
    actor: 'CLIENT',
  },
  {
    kind: 'CHOOSE_OFFERING',
    label: 'Let them choose what to book',
    hint: 'They pick from what you offer, and a time if you want one.',
    actor: 'CLIENT',
  },
  {
    kind: 'APPROVAL',
    label: 'You accept or move it',
    hint: 'It comes to you. Nothing carries on until you have said yes — or picked a different time.',
    actor: 'TRAINER',
  },
]

/**
 * The kinds worth offering in THIS flow.
 *
 * A class's reminders live on a clock, and three of the seven cannot be fired
 * by one (see `isClockRunnable`): a reminder has no business asking somebody
 * already enrolled to "choose what to book". Offering a kind that could never
 * run would be a menu entry whose only outcome is silence.
 */
export function flowStepKindsFor(anchor: FlowAnchor): FlowStepKindOption[] {
  if (anchor === 'PERSON') return FLOW_STEP_KIND_CATALOG
  return FLOW_STEP_KIND_CATALOG.filter(o => isClockRunnable(o.kind))
}

export interface FlowStepSummary {
  /** The row's first line — what this step does. */
  what: string
  /** When it fires, on its own. */
  when: string
  /** "wait for their answers", or null when the step doesn't block. */
  wait: string | null
  /** The row's second line: the wait if there is one, else the timing. */
  line: string
  /** Who moves — the chip on the row. */
  actor: FlowStepActor
  /** Why it can't run yet, from the same gate the engine asks. Null = ready. */
  problem: string | null
}

/**
 * One step, summarised for a row.
 *
 * `problem` comes from `flowStepConfigProblem` — the SAME call `executeFlowStep`
 * makes before it does anything — so a step the engine will silently skip is a
 * step the builder visibly flags. A trainer finding out from the absence of an
 * email that their FORM step had no form on it is the failure this closes.
 */
export function flowStepSummary(
  step: SummarisableStep,
  { index = 0, names = {} }: { index?: number; names?: FlowStepNames } = {},
): FlowStepSummary {
  const when = flowStepWhenText(step, index)
  const wait = flowStepWaitText(step)
  // In a journey the sequence IS the timing, so "Once the step before is done ·
  // wait for their answers" says the same thing twice. Everywhere else the two
  // are different facts and both are worth the room.
  const personAnchored = flowAnchorFor(step) === 'PERSON'
  const line = wait ? (personAnchored ? wait : `${when} · ${wait}`) : when

  return {
    what: flowStepWhatText(step, names),
    when,
    wait,
    line,
    actor: step.actor,
    problem: flowStepConfigProblem(step),
  }
}
