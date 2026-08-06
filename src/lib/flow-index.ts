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
// Type-only, so this module stays free of anything that reads a session.
import type { PermissionKey } from './permissions'
import type { RunKind } from './run-kind'

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

// ─── Editing a flow from somewhere other than its offering page ─────────────

/**
 * Which id `CommsFlowEditor` should be mounted with for this owner.
 *
 * The editor derives its whole API base from which of these four is set (see
 * comms-flow-editor.tsx), so handing it the right one is the ENTIRE difference
 * between editing from Settings and editing from the offering page. There is no
 * second component and no second set of routes: the same editor, pointed at the
 * same tree, from a different screen.
 *
 * Exactly one key is returned, always — anything else and the editor would
 * silently write to whichever branch its `?:` chain happened to reach first.
 */
export function flowEditorTarget(owner: Pick<FlowOwner, 'kind' | 'id'>): {
  runId?: string
  packageId?: string
  membershipId?: string
  formId?: string
} {
  switch (owner.kind) {
    // All four run shapes are one ClassRun with one CRUD tree; only the SCREEN
    // they are listed under differs.
    case 'CLASS':
    case 'CASUAL':
    case 'EVENT':
    case 'DAYCARE':
      return { runId: owner.id }
    case 'PACKAGE':
      return { packageId: owner.id }
    case 'MEMBERSHIP':
      return { membershipId: owner.id }
    case 'FORM':
      return { formId: owner.id }
    default: {
      const unhandled: never = owner.kind
      void unhandled
      return {}
    }
  }
}

/**
 * Which section a ClassRun is listed under.
 *
 * A ClassRun is the single model behind four sections of the app, and nothing
 * on the run says which — only the backing package does (lib/run-kind.ts). Both
 * the Settings tab and the timeline page need the answer, so it is stated once.
 */
export const FLOW_OWNER_KIND_BY_RUN_KIND: Record<RunKind, FlowOwnerKind> = {
  class: 'CLASS',
  casual: 'CASUAL',
  event: 'EVENT',
  daycare: 'DAYCARE',
}

/**
 * The URL segment a kind's own timeline page lives under.
 *
 * FOUR segments for seven kinds, deliberately: all four run shapes are one
 * ClassRun with one CRUD tree, so they are one page. It mirrors
 * `flowEditorTarget` exactly — the segment names ARE its four keys minus the
 * "Id" — because the page has to hand the editor the same one back.
 */
export type FlowTimelineSegment = 'run' | 'package' | 'membership' | 'form'

export const FLOW_TIMELINE_SEGMENT: Record<FlowOwnerKind, FlowTimelineSegment> = {
  CLASS: 'run',
  CASUAL: 'run',
  EVENT: 'run',
  DAYCARE: 'run',
  PACKAGE: 'package',
  MEMBERSHIP: 'membership',
  FORM: 'form',
}

/**
 * This flow, on a page of its own. Karl: "can it also be opened up on a new
 * page to remove distraction from the user".
 *
 * `from` is where Back goes — the screen they left, tab and all. Passed through
 * as a query rather than guessed at the other end: a flow can be opened from
 * six places and "somewhere generic" is the one wrong answer.
 */
export function flowTimelineHref(owner: Pick<FlowOwner, 'kind' | 'id'>, from?: string): string {
  const path = `/automations/${FLOW_TIMELINE_SEGMENT[owner.kind]}/${owner.id}`
  return from ? `${path}?from=${encodeURIComponent(from)}` : path
}

/**
 * The permission each kind's flow routes actually guard on.
 *
 * The index can now EDIT, so it must not offer a flow whose API will refuse the
 * save — an editor that loads and then 403s on the first change is worse than
 * not showing the flow at all. These are copied from the four CRUD routes and
 * drift-tested against them in tests/unit/flow-index.test.ts, because a copy
 * that rots here shows a trainer a flow they cannot touch.
 */
export const FLOW_OWNER_PERMISSION: Record<FlowOwnerKind, PermissionKey> = {
  CLASS: 'classes.manage',
  CASUAL: 'classes.manage',
  EVENT: 'classes.manage',
  DAYCARE: 'classes.manage',
  PACKAGE: 'packages.manage',
  // A membership's flow hangs off /api/trainer/memberships, which guards on
  // packages.manage — not a permission of its own.
  MEMBERSHIP: 'packages.manage',
  FORM: 'settings.edit',
}

/**
 * One flow's identity: what it hangs off. A step carries no key of its own that
 * means anything to a screen, and an id is only unique within its own table —
 * a package id and a form id can collide.
 */
export function ownerKey(owner: Pick<FlowOwner, 'kind' | 'id'>): string {
  return `${owner.kind}:${owner.id}`
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

/** The heading a single kind sits under — the picker groups by the same list. */
export function flowSectionLabel(kind: FlowOwnerKind): string {
  return FLOW_OWNER_SECTIONS.find(s => s.kind === kind)?.label ?? ''
}

// ─── Starting a new one ──────────────────────────────────────────────────────
//
// Karl, looking at the index: "why can't i do this from the automations page?"
// He could edit every automation here and start none, which is a strange half
// of a screen.
//
// An automation is not a thing you create — it is steps hanging off something
// you already have. So "new" is really "pick the class, package, membership or
// form, then open the editor on it", and NOTHING is written until the first step
// is saved. That is why an owner with no steps yet cannot be told apart from one
// that never will be, and why this list has to be built from the owners rather
// than from the flows.

export interface FlowOwnerChoice {
  owner: FlowOwner
  /**
   * It already has a flow. Deliberately still OFFERED rather than filtered out:
   * a trainer looking for "the puppy class" should find it where they expect
   * and not have to work out that its absence means it already has one. Picking
   * it opens the flow it has — it never starts a second one, because a flow has
   * no identity beyond its owner (see `ownerKey`).
   */
  hasFlow: boolean
}

/**
 * Everything a new automation could hang off, in the order the screen reads.
 *
 * `allow` is the permission test, taken as a predicate so this stays pure. It is
 * the SAME rule the list applies (FLOW_OWNER_PERMISSION): offering someone an
 * owner whose routes will 403 on the first step is the failure the list already
 * avoids, and a picker that does it is worse — they have chosen before they find
 * out.
 */
export function buildOwnerChoices(
  owners: FlowOwner[],
  flows: IndexedFlow[],
  allow: (kind: FlowOwnerKind) => boolean = () => true,
): FlowOwnerChoice[] {
  const withFlows = new Set(flows.map(f => ownerKey(f.owner)))
  return owners
    .filter(o => allow(o.kind))
    .map(owner => ({ owner, hasFlow: withFlows.has(ownerKey(owner)) }))
    .sort((a, b) => {
      const section = (SECTION_ORDER.get(a.owner.kind) ?? 99) - (SECTION_ORDER.get(b.owner.kind) ?? 99)
      if (section !== 0) return section
      return a.owner.name.localeCompare(b.owner.name, 'en-NZ')
    })
}

/** The choices in each section, in the section order, skipping empty sections. */
export function groupOwnerChoicesBySection(
  choices: FlowOwnerChoice[],
): { kind: FlowOwnerKind; label: string; choices: FlowOwnerChoice[] }[] {
  return FLOW_OWNER_SECTIONS.map(s => ({ ...s, choices: choices.filter(c => c.owner.kind === s.kind) }))
    .filter(s => s.choices.length > 0)
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
