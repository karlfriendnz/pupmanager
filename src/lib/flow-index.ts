// Every automation a trainer has, in one list.
//
// The builder mounts in FIVE places — a class run, a 1:1 package, an event, a
// membership and a form — so a trainer could not see what their own business
// was sending without opening every offering one at a time. Karl: "is there a
// page somewhere where we can see all the automations?" There wasn't.
//
// This is the reading half of that page. It is PURE — no Prisma, no React — for
// the same reason flow-step-summary.ts is: the grouping and the two flags a
// trainer needs (a flow that is off, a step the engine will skip) are the whole
// value of the screen, and a pure function is the only thing you can put a test
// on.
//
// It invents NO new phrasing. Every line a row shows comes from
// `flowStepSummary`, which is the same call the builder makes — so the index
// and the editor cannot describe the same step two different ways.
import { flowStepSummary, type FlowStepNames, type SummarisableStep } from './flow-step-summary'
import { sortStepsByTime } from './comms-flow-steps'
import { flowAnchorFor } from './flow-anchors'

/** What a flow hangs off. The four parents a CommsFlowStep can have, with the
 *  ClassRun ones split by section because that is how a trainer finds them. */
export type FlowOwnerKind = 'CLASS' | 'CASUAL' | 'EVENT' | 'DAYCARE' | 'PACKAGE' | 'MEMBERSHIP' | 'FORM'

export interface FlowOwner {
  kind: FlowOwnerKind
  id: string
  /** What the thing is called — the class, the package, the form. */
  name: string
  /** Where the EXISTING editor lives. The index is a way in, not a second one. */
  href: string
}

/** One step, as the index needs it. A superset of what the summary reads. */
export interface IndexedStep extends SummarisableStep {
  id: string
  enabled: boolean
  order: number
}

/** One line under a flow's name. */
export interface FlowIndexRow {
  stepId: string
  /** "Send form: Pre-class questions" — flowStepSummary's own words. */
  what: string
  /** The timing or the wait, whichever the summary chose. */
  line: string
  enabled: boolean
  /** Why the engine will skip it, from the same call the engine makes. */
  problem: string | null
}

export interface IndexedFlow {
  owner: FlowOwner
  steps: number
  /** Steps that are switched on. */
  liveSteps: number
  /**
   * Nothing in this flow will happen.
   *
   * A flow has no on/off switch of its own — each STEP has one — so "off" is
   * derived: no enabled step means the trainer built something and then turned
   * all of it off, which looks identical to a working flow from the offering
   * page they built it on. It is the first thing this screen exists to show.
   */
  off: boolean
  /** Steps `flowStepConfigProblem` says cannot run. */
  problems: FlowIndexRow[]
  rows: FlowIndexRow[]
}

/** The heading each kind sits under, and the order the sections read in. */
export const FLOW_OWNER_SECTIONS: { kind: FlowOwnerKind; label: string }[] = [
  { kind: 'CLASS', label: 'Group classes' },
  { kind: 'CASUAL', label: 'Casual classes' },
  { kind: 'EVENT', label: 'Events' },
  { kind: 'DAYCARE', label: 'Daycare' },
  { kind: 'PACKAGE', label: '1:1 sessions' },
  { kind: 'MEMBERSHIP', label: 'Packages' },
  { kind: 'FORM', label: 'Forms' },
]

const SECTION_ORDER = new Map(FLOW_OWNER_SECTIONS.map((s, i) => [s.kind, i]))

/**
 * The order a flow's steps read in.
 *
 * The SAME rule the builder uses (comms-flow-editor's `ordered`): a journey
 * reads in the order the trainer arranged it, because that order IS what
 * happens; a clock-anchored flow reads in the order it will actually fire,
 * which is not the order the messages were added in. A trainer opening a flow
 * from here must see the rows in the order the editor will show them, or the
 * index is describing a different flow from the one they land on.
 */
export function orderFlowSteps<T extends IndexedStep>(steps: T[]): T[] {
  const sequenced = steps.length > 0 && flowAnchorFor(steps[0]) === 'PERSON'
  return sequenced ? [...steps].sort((a, b) => a.order - b.order) : sortStepsByTime(steps)
}

/** One flow, summarised for a row. */
export function summariseFlow(
  owner: FlowOwner,
  steps: IndexedStep[],
  names: FlowStepNames = {},
): IndexedFlow {
  const ordered = orderFlowSteps(steps)
  const rows: FlowIndexRow[] = ordered.map((step, index) => {
    const summary = flowStepSummary(step, { index, names })
    return {
      stepId: step.id,
      what: summary.what,
      line: summary.line,
      enabled: step.enabled,
      problem: summary.problem,
    }
  })

  const liveSteps = rows.filter(r => r.enabled).length
  return {
    owner,
    steps: rows.length,
    liveSteps,
    off: rows.length > 0 && liveSteps === 0,
    // A misconfigured step that is switched OFF is not a problem a trainer has
    // to act on — the engine skips it either way, and flagging it would put a
    // warning on a flow that is doing exactly what they asked.
    problems: rows.filter(r => r.enabled && r.problem),
    rows,
  }
}

/**
 * Every flow, grouped and sorted for the screen.
 *
 * Sorted by section first (the order a trainer's own menu lists the sections
 * in), then by name — so the page reads the same way twice running, and a
 * trainer looking for one class does not have to scan a shuffled list.
 */
export function buildFlowIndex(
  flows: { owner: FlowOwner; steps: IndexedStep[] }[],
  names: FlowStepNames = {},
): IndexedFlow[] {
  return flows
    .map(f => summariseFlow(f.owner, f.steps, names))
    // A parent with no steps at all is not a flow. Nothing was built, so there
    // is nothing to see — and a page listing every class a trainer has ever run
    // would bury the handful that actually send something.
    .filter(f => f.steps > 0)
    .sort((a, b) => {
      const section = (SECTION_ORDER.get(a.owner.kind) ?? 99) - (SECTION_ORDER.get(b.owner.kind) ?? 99)
      if (section !== 0) return section
      return a.owner.name.localeCompare(b.owner.name, 'en-NZ')
    })
}

/** The flows in each section, in the section order, skipping empty sections. */
export function groupFlowsBySection(
  flows: IndexedFlow[],
): { kind: FlowOwnerKind; label: string; flows: IndexedFlow[] }[] {
  return FLOW_OWNER_SECTIONS.map(s => ({ ...s, flows: flows.filter(f => f.owner.kind === s.kind) }))
    .filter(s => s.flows.length > 0)
}

/** The one-line count under the page title: "6 automations · 1 off · 2 need setting up". */
export function flowIndexHeadline(flows: IndexedFlow[]): string {
  if (flows.length === 0) return 'Nothing automated yet'
  const parts = [`${flows.length} automation${flows.length === 1 ? '' : 's'}`]
  const off = flows.filter(f => f.off).length
  if (off > 0) parts.push(`${off} off`)
  const broken = flows.filter(f => f.problems.length > 0).length
  if (broken > 0) parts.push(`${broken} need${broken === 1 ? 's' : ''} setting up`)
  return parts.join(' · ')
}
