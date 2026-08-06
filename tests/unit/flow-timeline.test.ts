import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  FLOW_STAGES_BY_ANCHOR,
  flowStagesFor,
  flowStageOf,
  groupStepsByStage,
  reorderFlowSteps,
  type FlowStageKey,
  type StageableStep,
} from '@/lib/flow-timeline'
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
    expect(groups).toHaveLength(3)
    const empty = groups.filter(g => g.steps.length === 0)
    expect(empty).toHaveLength(2)
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
      'BEFORE_CONFIRM', 'DURING_SESSION', 'AFTER_SESSION',
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
      'Before they confirm', 'During the session', 'After the session',
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

  it('gives a membership one plain spine — it has no session to be during', () => {
    const groups = groupStepsByStage(
      [row({ id: 'a', direction: 'AFTER_PURCHASE' }), row({ id: 'b', direction: 'BEFORE_PERIOD_END' })],
      'PURCHASE',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].stage).toBeNull()
    expect(groups[0].steps.map(s => s.id)).toEqual(['a', 'b'])
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
    expect(groups[1].steps.map(s => s.id)).toEqual(['a', 'c'])
    expect(groups[2].steps.map(s => s.id)).toEqual(['b', 'd'])
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
    const save = editor.slice(editor.indexOf('async function saveDraft('), editor.indexOf('async function toggleEnabled('))
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
    expect(groups.map(g => g.steps.map(s => s.id))).toEqual([[], ['b', 'a'], ['c']])
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

// A new ENUM VALUE must be alone in its migration: Postgres refuses to use one
// added in the same transaction, Prisma wraps each migration in one, and the
// failure only shows up in production at `migrate deploy`.
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

  it('and each still offers the way through to it', () => {
    // The link is derived inside the editor from the id it already holds, so no
    // mount can forget it.
    const editor = file('src/components/trainer/comms-flow-editor.tsx')
    expect(editor).toContain('/automations/run/')
    expect(editor).toContain('/automations/package/')
    expect(editor).toContain('/automations/membership/')
    expect(editor).toContain('/automations/form/')
    expect(editor).toContain('Full screen')
  })
})
