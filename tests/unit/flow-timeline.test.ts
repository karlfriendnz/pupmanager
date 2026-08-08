import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  FLOW_STAGES_BY_ANCHOR,
  flowStagesFor,
  flowStageOf,
  flowStageAdd,
  flowStageMove,
  flowTimingOptions,
  flowTimingOptionsFor,
  flowTimingKey,
  canMoveStepToStage,
  groupStepsByStage,
  reorderFlowSteps,
  type FlowStageKey,
  type StageableStep,
} from '@/lib/flow-timeline'
import type { FlowAnchor } from '@/lib/flow-anchors'
import { commsTimelinePos, sortStepsByTime } from '@/lib/comms-flow-steps'
import { flowStepWhenText, type SummarisableStep } from '@/lib/flow-step-summary'
import {
  FLOW_OWNER_PERMISSION,
  FLOW_OWNER_SECTIONS,
  FLOW_TIMELINE_SEGMENT,
  FLOW_OWNER_KIND_BY_RUN_KIND,
  flowTimelineHref,
  type FlowOwnerKind,
} from '@/lib/flow-index'

// The builder read as a TIMELINE (Karl: "can the automation flow look like a
// timeline, can it also be opened up on a new page to remove distraction from
// the user"), cut into his three stages — "before they confirm, during the
// session, after the session" — under the rule that outranks all of it: "the
// idea is the flow — it should be very fluid and very flexible."
//
// So what is pinned here is the FLEXIBILITY as much as the grouping: any kind
// in any stage, a stage that holds nothing, and a fourth stage being a row in a
// table rather than a rewrite.

const file = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

function step(over: Partial<StageableStep> = {}): StageableStep {
  return { direction: 'BEFORE_SESSION', trigger: null, gatesBooking: false, ...over }
}

/** A step as the builder holds one — enough to group, order and renumber. */
function row(over: Partial<StageableStep> & { id: string; order?: number }) {
  return { order: 0, offsetMinutes: 0, ...step(over), ...over } as StageableStep & { id: string; order: number; offsetMinutes: number }
}

describe('which stage a step is in', () => {
  it('puts the booking gate first, whatever its clock says', () => {
    // A gate is answered while somebody is tapping Confirm — its direction and
    // offset are inert. Reading them first would file it under "1 day after"
    // because that is what the column held before the gate was switched on.
    expect(flowStageOf(step({ gatesBooking: true }))).toBe('BEFORE_CONFIRM')
    expect(flowStageOf(step({ gatesBooking: true, direction: 'AFTER_SESSION' }))).toBe('BEFORE_CONFIRM')
    expect(flowStageOf(step({ gatesBooking: true, direction: 'DURING_SESSION' }))).toBe('BEFORE_CONFIRM')
  })

  it('puts a whole enquiry journey before the booking', () => {
    // A journey runs from "somebody got in touch" to "you accepted" — there is
    // no confirmed booking anywhere in it.
    expect(flowStageOf(step({ trigger: 'ON_ENQUIRY_SUBMITTED' }))).toBe('BEFORE_CONFIRM')
    expect(flowStageOf(step({ trigger: 'ON_SIGNUP' }))).toBe('BEFORE_CONFIRM')
    expect(flowStageOf(step({ trigger: 'ON_BOOKING' }))).toBe('BEFORE_CONFIRM')
  })

  it('reads the clock for everything else', () => {
    expect(flowStageOf(step({ direction: 'DURING_SESSION' }))).toBe('DURING_SESSION')
    expect(flowStageOf(step({ direction: 'AFTER_SESSION' }))).toBe('AFTER_SESSION')
    // The run-up sits with the session it leads to: the stages are cut at the
    // booking being confirmed and at the session ending, and "see you tomorrow"
    // falls between them. The ROW still says "1 day before" — see below.
    expect(flowStageOf(step({ direction: 'BEFORE_SESSION' }))).toBe('DURING_SESSION')
  })

  it('says the exact timing on the row even so', () => {
    const reminder: SummarisableStep = {
      kind: 'MESSAGE', actor: 'CLIENT', trigger: null, direction: 'BEFORE_SESSION',
      offsetMinutes: 1440, blocking: false, channels: ['PUSH'], title: 'x', body: 'y',
    }
    expect(flowStepWhenText(reminder)).toBe('1 day before')
  })
})

describe('the stages are scaffolding, not slots', () => {
  it('takes ANY kind in ANY stage', () => {
    // Nothing in the grouping asks what a step IS. Karl's groom case happens to
    // be "a form before, the trainer during" and the shape must not assume it.
    const kinds = ['MESSAGE', 'FORM', 'UPLOAD', 'TASK', 'ACCOUNT', 'CHOOSE_OFFERING', 'APPROVAL']
    for (const kind of kinds) {
      for (const [direction, expected] of [
        ['BEFORE_SESSION', 'DURING_SESSION'],
        ['DURING_SESSION', 'DURING_SESSION'],
        ['AFTER_SESSION', 'AFTER_SESSION'],
      ] as [string, FlowStageKey][]) {
        expect(flowStageOf({ ...step({ direction }), kind } as StageableStep), `${kind} ${direction}`).toBe(expected)
      }
    }
  })

  it('renders an empty stage quietly rather than as a job to do', () => {
    const groups = groupStepsByStage([row({ id: 'a', direction: 'BEFORE_SESSION' })], 'SESSION')
    expect(groups).toHaveLength(4)
    const empty = groups.filter(g => g.steps.length === 0)
    expect(empty).toHaveLength(3)
    for (const g of empty) {
      // It says something, and what it says is a statement of fact — no call to
      // action, nothing to fix, no exclamation.
      expect(g.stage?.empty, g.stage?.key).toBeTruthy()
      expect(g.stage?.empty).not.toMatch(/add|set up|!/i)
    }
  })

  it('keeps every heading on screen when a stage empties', () => {
    // A heading that disappears when its stage empties is a heading that cannot
    // tell a trainer nothing follows their class up.
    expect(groupStepsByStage([], 'SESSION').map(g => g.stage?.key)).toEqual([
      'BEFORE_CONFIRM', 'ON_ENROLMENT', 'DURING_SESSION', 'AFTER_SESSION',
    ])
  })

  it('is a table, so a fourth stage is an entry and not a redesign', () => {
    for (const stages of Object.values(FLOW_STAGES_BY_ANCHOR)) {
      for (const stage of stages) {
        expect(stage.label).toBeTruthy()
        expect(stage.hint).toBeTruthy()
        expect(stage.empty).toBeTruthy()
      }
    }
    expect(flowStagesFor('SESSION').map(s => s.label)).toEqual([
      'Before they confirm', 'When they enrol', 'During the session', 'After the session',
    ])
  })

  it('gives a journey the one stage it can actually fill', () => {
    // Offering an enquiry journey a "During the session" heading that could
    // never fill is an invitation to put something nowhere.
    expect(flowStagesFor('PERSON').map(s => s.key)).toEqual(['BEFORE_CONFIRM'])
    const groups = groupStepsByStage(
      [row({ id: 'a', trigger: 'ON_ENQUIRY_SUBMITTED' }), row({ id: 'b', trigger: 'ON_ENQUIRY_SUBMITTED' })],
      'PERSON',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].steps.map(s => s.id)).toEqual(['a', 'b'])
  })

  // Karl: "there should also be an 'after signup' section". A membership is the
  // one anchor where that moment is real and the engine can fire it —
  // AFTER_PURCHASE is somebody joining (processMembershipStep counts forward
  // from their purchase). It gets that stage and the renewal run-up, and none
  // of the session ones.
  it('gives a membership its own two stages — joining, and the run-up to renewal', () => {
    expect(flowStagesFor('PURCHASE').map(s => s.key)).toEqual(['AFTER_SIGNUP', 'BEFORE_RENEWAL'])

    const groups = groupStepsByStage(
      [row({ id: 'a', direction: 'AFTER_PURCHASE' }), row({ id: 'b', direction: 'BEFORE_PERIOD_END' })],
      'PURCHASE',
    )
    expect(groups).toHaveLength(2)
    expect(groups[0].stage?.key).toBe('AFTER_SIGNUP')
    expect(groups[0].steps.map(s => s.id)).toEqual(['a'])
    expect(groups[1].stage?.key).toBe('BEFORE_RENEWAL')
    expect(groups[1].steps.map(s => s.id)).toEqual(['b'])
  })

  // A stage must never be offered where the engine could not fire it. Which
  // means BOTH halves have to hold: the moment "somebody joined" is real on a
  // membership AND on an offering, but it is a different row, a different
  // column and a different pass in each — so each anchor gets the one its own
  // engine pass can actually fire, and never the other's.
  it('never offers a joining stage the wrong engine pass would have to run', () => {
    // "After signup" is fired by processMembershipStep counting AFTER_PURCHASE
    // forward from a MembershipPurchase. Nothing on a class or a 1:1 has one.
    expect(flowStagesFor('SESSION').map(s => s.key)).not.toContain('AFTER_SIGNUP')
    expect(flowStagesFor('PERSON').map(s => s.key)).not.toContain('AFTER_SIGNUP')
    // "When they enrol" is fired by processEnrolmentStep walking
    // ClassEnrollment / ClientPackage rows. A membership has neither, and a
    // person-anchored journey has no clock at all.
    expect(flowStagesFor('PURCHASE').map(s => s.key)).not.toContain('ON_ENROLMENT')
    expect(flowStagesFor('PERSON').map(s => s.key)).not.toContain('ON_ENROLMENT')
  })

  // Karl: "hmm yeah when they enrol is better" — for "things like a thank you
  // message etc". A class and a 1:1 package DO have a joining moment; it is the
  // enrolment row, which is why it gets a direction and a pass of its own.
  it('gives an offering the joining stage, before the run-up to its sessions', () => {
    expect(flowStagesFor('SESSION').map(s => s.key)).toEqual([
      'BEFORE_CONFIRM', 'ON_ENROLMENT', 'DURING_SESSION', 'AFTER_SESSION',
    ])
    expect(flowStageOf(step({ direction: 'ON_ENROLMENT' }))).toBe('ON_ENROLMENT')

    const groups = groupStepsByStage(
      [row({ id: 'welcome', direction: 'ON_ENROLMENT' }), row({ id: 'nudge', direction: 'BEFORE_SESSION' })],
      'SESSION',
    )
    expect(groups[1].stage?.key).toBe('ON_ENROLMENT')
    expect(groups[1].steps.map(s => s.id)).toEqual(['welcome'])
    expect(groups[2].steps.map(s => s.id)).toEqual(['nudge'])
  })

  // The words differ because the moments differ: you enrol ON a class, you sign
  // up FOR a recurring plan. A membership keeps the stage it already had.
  it('keeps the membership wording, and uses Karl’s for an offering', () => {
    expect(flowStagesFor('PURCHASE').map(s => s.label)).toEqual(['After signup', 'Before it renews'])
    expect(flowStagesFor('SESSION').find(s => s.key === 'ON_ENROLMENT')?.label).toBe('When they enrol')
  })

  // A booking gate still outranks everything, including this.
  it('files a gating form before the booking even if it says ON_ENROLMENT', () => {
    expect(flowStageOf(step({ gatesBooking: true, direction: 'ON_ENROLMENT' }))).toBe('BEFORE_CONFIRM')
  })

  it('never loses a step off the screen it is edited on', () => {
    // Including one whose stage this anchor does not have: it goes in the first
    // stage rather than nowhere.
    const steps = [
      row({ id: 'gate', gatesBooking: true }),
      row({ id: 'before', direction: 'BEFORE_SESSION' }),
      row({ id: 'during', direction: 'DURING_SESSION' }),
      row({ id: 'after', direction: 'AFTER_SESSION' }),
      row({ id: 'odd', direction: 'AFTER_PURCHASE' }),
    ]
    const seen = groupStepsByStage(steps, 'SESSION').flatMap(g => g.steps.map(s => s.id))
    expect(seen.sort()).toEqual(['after', 'before', 'during', 'gate', 'odd'])
  })

  it('keeps the order it was handed within each stage', () => {
    const groups = groupStepsByStage(
      [
        row({ id: 'a', direction: 'BEFORE_SESSION' }),
        row({ id: 'b', direction: 'AFTER_SESSION' }),
        row({ id: 'c', direction: 'DURING_SESSION' }),
        row({ id: 'd', direction: 'AFTER_SESSION' }),
      ],
      'SESSION',
    )
    // [0] the booking gate, [1] joining, [2] the run-up + the session, [3] after.
    expect(groups[2].steps.map(s => s.id)).toEqual(['a', 'c'])
    expect(groups[3].steps.map(s => s.id)).toEqual(['b', 'd'])
  })
})

// A stage is DERIVED every time it is asked for. A column would be a second
// answer to "when does this happen", and the two would drift the first time a
// PATCH touched one — the exact trap the trigger/direction split was written to
// avoid.
describe('a step’s stage is derived, not stored', () => {
  const schema = file('prisma/schema.prisma')
  const model = schema.slice(schema.indexOf('model CommsFlowStep {'), schema.indexOf('@@map("comms_flow_steps")'))

  it('has no stage column on the step', () => {
    expect(model).not.toMatch(/^\s*stage\s/m)
    expect(model).not.toMatch(/FlowStage/)
  })

  it('is not sent by the builder either', () => {
    const editor = file('src/components/trainer/comms-flow-editor.tsx')
    // The one place the builder writes a step. If a stage ever appears in this
    // payload, there are two answers to when a step happens.
    // Anchored to the function that FOLLOWS saveDraft. It used to be
    // toggleEnabled, which no longer exists (the row's on/off switch moved
    // into the step sheet, so `enabled` rides on this same save) — and an
    // indexOf that misses returns -1, which quietly slices to the end of the
    // file and made this pass or fail for the wrong reason.
    const end = editor.indexOf('async function remove(')
    expect(end).toBeGreaterThan(0)
    const save = editor.slice(editor.indexOf('async function saveDraft('), end)
    expect(save).toContain('direction')
    expect(save).not.toMatch(/\bstage\b/)
  })

  it('changes the moment the facts it reads change', () => {
    const s = step({ direction: 'AFTER_SESSION' })
    expect(flowStageOf(s)).toBe('AFTER_SESSION')
    expect(flowStageOf({ ...s, gatesBooking: true })).toBe('BEFORE_CONFIRM')
    expect(flowStageOf({ ...s, direction: 'DURING_SESSION' })).toBe('DURING_SESSION')
  })
})

describe('moving a step', () => {
  const list = [
    row({ id: 'a', order: 0, direction: 'BEFORE_SESSION' }),
    row({ id: 'b', order: 1, direction: 'DURING_SESSION' }),
    row({ id: 'c', order: 2, direction: 'AFTER_SESSION' }),
  ]

  it('rewrites order so a RELOAD shows what they dropped (AGENTS.md #1)', () => {
    const next = reorderFlowSteps(list, 'c', 'a')
    expect(next.map(s => s.id)).toEqual(['c', 'a', 'b'])
    expect(next.map(s => s.order)).toEqual([0, 1, 2])
  })

  it('moves across a stage heading exactly as it does within one', () => {
    // The spine is ONE list. A step dragged past a heading is the same splice.
    const next = reorderFlowSteps(list, 'a', 'c')
    expect(next.map(s => s.id)).toEqual(['b', 'c', 'a'])
    expect(next.map(s => s.order)).toEqual([0, 1, 2])
    // …and the stages still hold what they held: dragging changes the ORDER,
    // never the timing, so it never moves a step to another stage.
    const groups = groupStepsByStage(next, 'SESSION')
    expect(groups.map(g => g.steps.map(s => s.id))).toEqual([[], [], ['b', 'a'], ['c']])
  })

  it('leaves the flow alone when either end of the drag is gone', () => {
    expect(reorderFlowSteps(list, 'a', 'ghost')).toBe(list)
    expect(reorderFlowSteps(list, 'ghost', 'a')).toBe(list)
    expect(reorderFlowSteps(list, 'a', 'a')).toBe(list)
  })
})

// "During the session" is the one thing the other two directions could not say.
describe('"during the session" on the timeline', () => {
  it('sits at the session itself, between the run-up and the follow-up', () => {
    expect(commsTimelinePos({ direction: 'BEFORE_SESSION', offsetMinutes: 15 })).toBeLessThan(
      commsTimelinePos({ direction: 'DURING_SESSION', offsetMinutes: 0 }),
    )
    expect(commsTimelinePos({ direction: 'AFTER_SESSION', offsetMinutes: 60 })).toBeGreaterThan(
      commsTimelinePos({ direction: 'DURING_SESSION', offsetMinutes: 0 }),
    )
  })

  it('is not moved by a lead time left over from when it was a reminder', () => {
    // offsetMinutes is inert for this direction — the engine never reads it.
    expect(commsTimelinePos({ direction: 'DURING_SESSION', offsetMinutes: 1440 })).toBe(
      commsTimelinePos({ direction: 'DURING_SESSION', offsetMinutes: 0 }),
    )
  })

  it('reads as a window rather than a number', () => {
    const during: SummarisableStep = {
      kind: 'MESSAGE', actor: 'CLIENT', trigger: null, direction: 'DURING_SESSION',
      offsetMinutes: 1440, blocking: false, channels: ['PUSH'], title: 'x', body: 'y',
    }
    expect(flowStepWhenText(during)).toBe('While the session is on')
  })

  it('sorts a whole flow into the order it happens', () => {
    const flow = [
      { id: 'after', direction: 'AFTER_SESSION', offsetMinutes: 120, order: 0 },
      { id: 'during', direction: 'DURING_SESSION', offsetMinutes: 0, order: 1 },
      { id: 'before', direction: 'BEFORE_SESSION', offsetMinutes: 1440, order: 2 },
    ]
    expect(sortStepsByTime(flow).map(s => s.id)).toEqual(['before', 'during', 'after'])
  })

  it('reads back every existing row exactly as it did', () => {
    // The new value is additive: nothing that was written before it moves.
    expect(commsTimelinePos({ direction: 'BEFORE_SESSION', offsetMinutes: 1440 })).toBe(-1440)
    expect(commsTimelinePos({ direction: 'AFTER_SESSION', offsetMinutes: 120 })).toBe(120)
    expect(commsTimelinePos({ direction: 'AFTER_PURCHASE', offsetMinutes: 60 })).toBe(60)
    expect(commsTimelinePos({ direction: 'BEFORE_PERIOD_END', offsetMinutes: 1440 })).toBe(1_000_000 - 1440)
  })
})

// Karl, on a screenshot of the empty timeline with a box drawn at the right of
// each stage heading: "please put the add step buttons here". A step added from
// a heading has to land back under THAT heading — which is the whole point of
// the change, and exactly the sort of thing that silently regresses.
describe('adding a step from a stage heading', () => {
  const ANCHORS: FlowAnchor[] = ['SESSION', 'PERSON', 'PURCHASE']

  it('lands the new step back in the stage it was added from', () => {
    for (const anchor of ANCHORS) {
      for (const stage of flowStagesFor(anchor)) {
        const { seed } = flowStageAdd(stage.key, anchor)
        // The step the API would create: the app's defaults, with the seed on
        // top. A person-anchored one carries its trigger, exactly as
        // withFormDefaults forces it to.
        const created: StageableStep = {
          direction: 'BEFORE_SESSION',
          trigger: anchor === 'PERSON' ? 'ON_ENQUIRY_SUBMITTED' : null,
          gatesBooking: false,
          ...seed,
        }
        expect(flowStageOf(created), `${anchor} / ${stage.key}`).toBe(stage.key)
        // …and it is drawn under that heading, not merely classified there.
        const groups = groupStepsByStage([{ ...created, id: 'new', order: 0 }], anchor)
        const landed = groups.find(g => g.steps.length === 1)
        expect(landed?.stage?.key, `${anchor} / ${stage.key}`).toBe(stage.key)
      }
    }
  })

  it('seeds columns the step already has — never a stage of its own', () => {
    // A stored stage would be a second answer to when a step happens. Everything
    // seeded here is a column the sheet itself edits.
    const allowed = new Set(['direction', 'offsetMinutes', 'gatesBooking'])
    for (const anchor of ANCHORS) {
      for (const stage of flowStagesFor(anchor)) {
        for (const key of Object.keys(flowStageAdd(stage.key, anchor).seed)) {
          expect(allowed.has(key), `${stage.key}: ${key}`).toBe(true)
        }
      }
    }
  })

  it('starts a "when they enrol" step straight away, not a day later', () => {
    // A thank-you that arrives tomorrow is not a thank-you (Karl).
    expect(flowStageAdd('ON_ENROLMENT', 'SESSION').seed).toEqual({ direction: 'ON_ENROLMENT', offsetMinutes: 0 })
    // A follow-up is not the same shape: "right as it ends" is a poor default
    // for one, so the run-up and the follow-up both start a day out.
    expect(flowStageAdd('DURING_SESSION', 'SESSION').seed).toEqual({ direction: 'BEFORE_SESSION', offsetMinutes: 1440 })
    expect(flowStageAdd('AFTER_SESSION', 'SESSION').seed).toEqual({ direction: 'AFTER_SESSION', offsetMinutes: 1440 })
  })

  it('every stage a step can be added to starts on a timing that stage offers', () => {
    // Otherwise the WHEN select opens on a value matching no option, and a
    // select with no matching value silently shows the FIRST one.
    for (const anchor of ANCHORS) {
      for (const stage of flowStagesFor(anchor)) {
        const seed = flowStageAdd(stage.key, anchor).seed
        const options = flowTimingOptions(stage.key, anchor)
        if (options.length === 0 || seed.direction === undefined) continue
        expect(
          options.some(o => o.direction === seed.direction && o.offsetMinutes === seed.offsetMinutes),
          `${anchor} / ${stage.key}`,
        ).toBe(true)
      }
    }
  })

  it('offers only a form from the booking gate, because only a form can be one', () => {
    // The server REFUSES gatesBooking on any other kind (refineStep), so any
    // other choice from that heading would be a step that could not stay where
    // it was put.
    expect(flowStageAdd('BEFORE_CONFIRM', 'SESSION')).toEqual({ seed: { gatesBooking: true }, kinds: ['FORM'] })
    // A journey is entirely pre-booking, so its one stage narrows nothing.
    expect(flowStageAdd('BEFORE_CONFIRM', 'PERSON')).toEqual({ seed: {} })
  })

  it('is driven by the stage table, so a new stage gets a button for free', () => {
    const editor = file('src/components/trainer/comms-flow-editor.tsx')
    // One button, rendered per stage from flowStageAdd(stage.key, anchor) —
    // not three written out by hand.
    expect(editor).toContain('setPicking(flowStageAdd(stage.key, anchor))')
    expect(editor).toContain('Add step: ${stage.label}')
    // And the generic bottom one is gone: two ways to do the same thing is the
    // rule this repo keeps breaking. What is left is the no-headings fallback.
    expect(editor).toContain('stages.every(g => !g.stage)')
    // The starter stays at the bottom — it fills every stage, not one.
    expect(editor).toContain('Use starter reminders')
  })
})

// Karl, once every heading had its own Add step: "i dont think we need this now
// that we have our add steps right?" — so the sheet stopped asking which stage a
// step is in. Which makes the per-stage Add buttons load-bearing, and makes a
// way OUT of the wrong stage mandatory.
describe('moving a step to another stage', () => {
  const ANCHORS: FlowAnchor[] = ['SESSION', 'PERSON', 'PURCHASE']

  it('renders the moved step under the new heading', () => {
    for (const anchor of ANCHORS) {
      for (const from of flowStagesFor(anchor)) {
        for (const to of flowStagesFor(anchor)) {
          if (!canMoveStepToStage('MESSAGE', to.key, anchor)) continue
          const before: StageableStep = {
            trigger: anchor === 'PERSON' ? 'ON_ENQUIRY_SUBMITTED' : null,
            gatesBooking: false,
            direction: 'BEFORE_SESSION',
            ...flowStageAdd(from.key, anchor).seed,
          }
          const after = { ...before, ...flowStageMove(to.key, anchor) }
          expect(flowStageOf(after), `${anchor}: ${from.key} → ${to.key}`).toBe(to.key)
          const groups = groupStepsByStage([{ ...after, id: 'moved', order: 0 }], anchor)
          expect(groups.find(g => g.steps.length === 1)?.stage?.key).toBe(to.key)
        }
      }
    }
  })

  it('takes the booking gate down on the way out, and puts it back on the way in', () => {
    // Moving out of "Before they confirm" without clearing gatesBooking would
    // leave the step reading as a gate for ever — flowStageOf answers it first.
    const gate: StageableStep = { gatesBooking: true, trigger: null, direction: 'BEFORE_SESSION' }
    const moved = { ...gate, ...flowStageMove('AFTER_SESSION', 'SESSION') }
    expect(moved.gatesBooking).toBe(false)
    expect(flowStageOf(moved)).toBe('AFTER_SESSION')

    const back = { ...moved, ...flowStageMove('BEFORE_CONFIRM', 'SESSION') }
    expect(back.gatesBooking).toBe(true)
    expect(flowStageOf(back)).toBe('BEFORE_CONFIRM')
  })

  it('lands the moved step on a timing that still makes sense', () => {
    // Not the lead time it happened to hold. A "1 day before" reminder moved to
    // the follow-up must not become "1 day before" of nothing.
    const reminder: SummarisableStep = {
      kind: 'MESSAGE', actor: 'CLIENT', trigger: null, blocking: false, channels: ['PUSH'],
      title: 'x', body: 'y', direction: 'BEFORE_SESSION', offsetMinutes: 1440,
    }
    expect(flowStepWhenText({ ...reminder, ...flowStageMove('ON_ENROLMENT', 'SESSION') })).toBe('When they enrol')
    expect(flowStepWhenText({ ...reminder, ...flowStageMove('AFTER_SESSION', 'SESSION') })).toBe('1 day after')
  })

  it('never offers a stage the step could not be', () => {
    // Only a form can hold up a booking — the server refuses gatesBooking on
    // anything else, so the move would be a no-op that looked like it worked.
    expect(canMoveStepToStage('MESSAGE', 'BEFORE_CONFIRM', 'SESSION')).toBe(false)
    expect(canMoveStepToStage('TASK', 'BEFORE_CONFIRM', 'SESSION')).toBe(false)
    expect(canMoveStepToStage('FORM', 'BEFORE_CONFIRM', 'SESSION')).toBe(true)
    // Everything can be anywhere else — the stages are scaffolding, not slots.
    for (const stage of ['ON_ENROLMENT', 'DURING_SESSION', 'AFTER_SESSION'] as FlowStageKey[]) {
      expect(canMoveStepToStage('MESSAGE', stage, 'SESSION'), stage).toBe(true)
    }
  })

  it('offers it in the sheet footer, beside Delete', () => {
    const editor = file('src/components/trainer/comms-flow-editor.tsx')
    expect(editor).toContain('flowStageMove(to.key, anchor)')
    expect(editor).toContain('Move to…')
    expect(editor).toContain('canMoveStepToStage')
  })
})

// The sheet asks WHEN INSIDE the stage, and nothing else. One control, because
// two produced the sentence "Sends right on before".
describe('the WHEN list, inside a stage', () => {
  const asStep = (t: { direction: string; offsetMinutes: number }): SummarisableStep => ({
    kind: 'MESSAGE', actor: 'CLIENT', trigger: null, blocking: false,
    channels: ['PUSH'], title: 'x', body: 'y', ...t,
  })

  it('offers the run-up AND the session itself from one list', () => {
    // Two directions, one question. Without this the "During the session" stage
    // could only ever hold whatever it was seeded with.
    const options = flowTimingOptions('DURING_SESSION', 'SESSION')
    expect(options.map(o => o.direction)).toContain('BEFORE_SESSION')
    expect(options[options.length - 1]).toEqual({ direction: 'DURING_SESSION', offsetMinutes: 0 })
    // Earliest first, the same order the timeline draws them in.
    const positions = options.map(o => commsTimelinePos(o))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('reads as a whole sentence for every stage', () => {
    // "Sends right on before" is what two controls produced. Each option is a
    // complete answer to "when", phrased by the one tested function.
    for (const anchor of ['SESSION', 'PURCHASE'] as FlowAnchor[]) {
      for (const stage of flowStagesFor(anchor)) {
        for (const t of flowTimingOptions(stage.key, anchor)) {
          const words = flowStepWhenText(asStep(t))
          const where = `${stage.key} ${t.direction}/${t.offsetMinutes}`
          expect(words, where).toBeTruthy()
          // A complete answer: never "0 min", never a bare "right on" that only
          // made sense with a segmented button sitting beside it.
          expect(words, where).not.toMatch(/^0\b/)
          expect(words, where).not.toMatch(/^right on/i)
          expect(words[0], where).toBe(words[0].toUpperCase())
        }
      }
    }
    // The specific ones a trainer reads most.
    expect(flowStepWhenText(asStep({ direction: 'ON_ENROLMENT', offsetMinutes: 0 }))).toBe('When they enrol')
    expect(flowStepWhenText(asStep({ direction: 'BEFORE_SESSION', offsetMinutes: 0 }))).toBe('When the session starts')
    expect(flowStepWhenText(asStep({ direction: 'DURING_SESSION', offsetMinutes: 0 }))).toBe('While the session is on')
    expect(flowStepWhenText(asStep({ direction: 'AFTER_SESSION', offsetMinutes: 0 }))).toBe('When the session ends')
  })

  it('has nothing to choose where there is no clock', () => {
    // A gate is answered while somebody is tapping Confirm; a journey's steps
    // are unlocked by the one before.
    expect(flowTimingOptions('BEFORE_CONFIRM', 'SESSION')).toEqual([])
    expect(flowTimingOptions('BEFORE_CONFIRM', 'PERSON')).toEqual([])
  })

  it('never warns about a renewal at the instant it renews', () => {
    expect(flowTimingOptions('BEFORE_RENEWAL', 'PURCHASE').every(o => o.offsetMinutes > 0)).toBe(true)
  })

  it('keeps a saved value the list does not offer, rather than showing the wrong one', () => {
    // A select whose value matches no option shows the FIRST one instead — the
    // box would read "1 week before" about a step that fires in 45 minutes.
    const odd = { direction: 'BEFORE_SESSION', offsetMinutes: 45 }
    const options = flowTimingOptionsFor(odd, 'DURING_SESSION', 'SESSION')
    expect(options[0]).toEqual(odd)
    expect(options.some(o => flowTimingKey(o) === flowTimingKey(odd))).toBe(true)
  })

  it('matches a "during" step on its direction alone — its offset is inert', () => {
    // The column deliberately keeps whatever lead time the step held before it
    // was switched, so switching back restores it. Keying on the pair would
    // leave a DURING_SESSION step matching no option at all.
    const stale = { direction: 'DURING_SESSION', offsetMinutes: 1440 }
    expect(flowTimingKey(stale)).toBe('DURING_SESSION')
    expect(flowTimingKey({ direction: 'DURING_SESSION', offsetMinutes: 0 })).toBe('DURING_SESSION')
    const options = flowTimingOptionsFor(stale, 'DURING_SESSION', 'SESSION')
    expect(options.filter(o => o.direction === 'DURING_SESSION')).toHaveLength(1)
    expect(options.some(o => flowTimingKey(o) === flowTimingKey(stale))).toBe(true)
  })

  it('is the ONLY timing control left in the sheet', () => {
    const editor = file('src/components/trainer/comms-flow-editor.tsx')
    const sheet = editor.slice(editor.indexOf('function StepSheet('))
    // The segmented stage buttons are gone (Karl). What is left is one select
    // keyed by flowTimingKey.
    expect(sheet).not.toMatch(/'BEFORE_SESSION', 'DURING_SESSION', 'AFTER_SESSION'/)
    expect(sheet).toContain('flowTimingKey(draft)')
    expect(sheet).toContain('flowTimingOptionsFor')
  })
})

// A new ENUM VALUE must be alone in its migration: Postgres refuses to use one
// added in the same transaction, Prisma wraps each migration in one, and the
// failure only shows up in production at `migrate deploy`.
describe('the ON_ENROLMENT migration', () => {
  const path = 'prisma/migrations/20260806240000_flow_on_enrolment/migration.sql'
  const sql = file(path)

  it('adds the value to both enums that mirror each other', () => {
    expect(sql).toContain(`ALTER TYPE "CommsFlowDirection" ADD VALUE IF NOT EXISTS 'ON_ENROLMENT'`)
    expect(sql).toContain(`ALTER TYPE "FlowTrigger" ADD VALUE IF NOT EXISTS 'ON_ENROLMENT'`)
  })

  it('does nothing else at all — and can be run twice', () => {
    const statements = sql
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('--'))
    expect(statements).toHaveLength(2)
    for (const s of statements) expect(s).toContain('IF NOT EXISTS')
  })

  it('ledgers the sends in a SEPARATE migration, which uses neither value', () => {
    // Anything that reads or writes a new enum value belongs after the file that
    // adds it — see the header of the file above.
    const columns = file('prisma/migrations/20260806241000_comms_flow_send_enrolment/migration.sql')
    const statements = columns.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(statements).not.toContain('ON_ENROLMENT')
    expect(columns).toContain('ADD COLUMN IF NOT EXISTS "enrollmentId"')
    expect(columns).toContain('ADD COLUMN IF NOT EXISTS "clientPackageId"')
    // @@map snake_case table names, never the Prisma model names.
    expect(columns).toContain('"class_enrollments"')
    expect(columns).toContain('"client_packages"')
    expect(columns).not.toMatch(/"ClassEnrollment"|"ClientPackage"|"CommsFlowSend"/)
  })

  it('is declared in the schema too, on both enums', () => {
    const schema = file('prisma/schema.prisma')
    const direction = schema.slice(schema.indexOf('enum CommsFlowDirection'), schema.indexOf('enum CommsFlowAudience'))
    expect(direction).toMatch(/^\s*ON_ENROLMENT\s*$/m)
    const trigger = schema.slice(schema.indexOf('enum FlowTrigger'), schema.indexOf('enum FlowRunStatus'))
    expect(trigger).toMatch(/^\s*ON_ENROLMENT\s*$/m)
  })
})

describe('the DURING_SESSION migration', () => {
  const path = 'prisma/migrations/20260806220000_flow_during_session/migration.sql'
  const sql = file(path)

  it('adds the value to both enums that mirror each other', () => {
    expect(sql).toContain(`ALTER TYPE "CommsFlowDirection" ADD VALUE IF NOT EXISTS 'DURING_SESSION'`)
    expect(sql).toContain(`ALTER TYPE "FlowTrigger" ADD VALUE IF NOT EXISTS 'DURING_SESSION'`)
  })

  it('does nothing else at all — and can be run twice', () => {
    const statements = sql
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('--'))
    expect(statements).toHaveLength(2)
    for (const s of statements) expect(s).toContain('IF NOT EXISTS')
  })

  it('is declared in the schema too', () => {
    const schema = file('prisma/schema.prisma')
    const direction = schema.slice(schema.indexOf('enum CommsFlowDirection'), schema.indexOf('enum CommsFlowAudience'))
    expect(direction).toMatch(/^\s*DURING_SESSION\s*$/m)
  })
})

// The flow on a page of its own. There is still exactly ONE editor.
describe('the full-screen timeline page', () => {
  const page = file('src/app/(trainer)/automations/[target]/[id]/page.tsx')

  it('guards on the same permission the in-place editor does', () => {
    // Settings already discovered the four flow routes guard on THREE different
    // permissions; FLOW_OWNER_PERMISSION is where that is written down.
    expect(page).toContain('FLOW_OWNER_PERMISSION[found.owner.kind]')
    expect(page).toContain('can(')
  })

  it('mounts THE editor, pointed by the same map the other six mounts use', () => {
    expect(page).toContain('flowEditorTarget(owner)')
    expect(page).toContain('<CommsFlowEditor')
    // No second implementation, anywhere.
    const defs = ['src/components/trainer/comms-flow-editor.tsx']
    expect(defs.map(d => file(d).includes('export function CommsFlowEditor'))).toEqual([true])
  })

  it('goes back where they came from, and only ever inside the app', () => {
    expect(page).toContain('safeReturnTo')
    // An absolute or protocol-relative `from` is an open redirect wearing a
    // Back button.
    expect(page).toMatch(/startsWith\('\/\/'\)/)
    expect(page).toContain('?? owner.href')
  })

  it('accepts exactly the segments the href builder produces', () => {
    const segments = new Set(Object.values(FLOW_TIMELINE_SEGMENT))
    for (const s of segments) expect(page).toContain(`'${s}'`)
    // Four segments for seven kinds: all four run shapes are one ClassRun.
    expect([...segments].sort()).toEqual(['form', 'membership', 'package', 'run'])
    for (const { kind } of FLOW_OWNER_SECTIONS) {
      expect(FLOW_TIMELINE_SEGMENT[kind as FlowOwnerKind], kind).toBeTruthy()
      expect(FLOW_OWNER_PERMISSION[kind as FlowOwnerKind], kind).toBeTruthy()
    }
  })

  it('builds an href that carries the way back', () => {
    expect(flowTimelineHref({ kind: 'EVENT', id: 'run1' })).toBe('/automations/run/run1')
    expect(flowTimelineHref({ kind: 'FORM', id: 'f1' }, '/settings?tab=automations')).toBe(
      '/automations/form/f1?from=%2Fsettings%3Ftab%3Dautomations',
    )
  })

  it('lists every run shape under the section it is found in', () => {
    expect(FLOW_OWNER_KIND_BY_RUN_KIND).toEqual({
      class: 'CLASS', casual: 'CASUAL', event: 'EVENT', daycare: 'DAYCARE',
    })
  })
})

// The whole point of one editor is that adding a page does not disturb the
// places it already lives.
describe('the five in-place mounts are unchanged', () => {
  const mounts = [
    'src/app/(trainer)/classes/[runId]/run-detail.tsx',
    'src/app/(trainer)/packages/[packageId]/package-detail.tsx',
    'src/app/(trainer)/events/[eventId]/event-detail.tsx',
    'src/app/(trainer)/memberships/memberships-view.tsx',
    'src/app/(trainer)/forms/client/client-form-editor.tsx',
  ]

  it('all still mount the same component', () => {
    for (const m of mounts) expect(file(m), m).toContain('<CommsFlowEditor')
  })

  it('none of them claims to be the full page', () => {
    // `fullPage` drops the editor's own border and hides the link out. A panel
    // on somebody else's screen is neither.
    for (const m of mounts) expect(file(m), m).not.toContain('fullPage')
  })

  it('the editor no longer advertises the full-screen page', () => {
    // It used to carry a "Full screen" link to the same flow on its own page.
    // Karl removed it on 2026-08-07: the editor already IS the whole tab it
    // sits in, so that was a second door to the room you were standing in.
    const editor = file('src/components/trainer/comms-flow-editor.tsx')
    expect(editor).not.toContain('Full screen')
    expect(editor).not.toContain('/automations/package/')
  })

  it('but the page is still reachable, so the route is not orphaned', () => {
    // Settings → Automations is the way in now: every row links to a flow's
    // own timeline. If that ever stops, these pages become unreachable code.
    const panel = file('src/app/(trainer)/settings/automations-panel.tsx')
    expect(panel).toContain('flowTimelineHref')
  })
})
