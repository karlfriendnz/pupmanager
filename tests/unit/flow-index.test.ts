import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  buildFlowIndex,
  summariseFlow,
  orderFlowSteps,
  groupFlowsBySection,
  flowIndexHeadline,
  FLOW_OWNER_SECTIONS,
  type FlowOwner,
  type IndexedStep,
} from '@/lib/flow-index'

// One page for every automation a trainer has, because the builder mounts in
// FIVE places and until now the only way to see what the business sends was to
// open every offering one at a time (Karl: "is there a page somewhere where we
// can see all the automations?").
//
// The two things the page must get right are the two states a trainer cannot
// see from the offering screen it was built on: a flow that is OFF, and a step
// the engine will silently skip.

function owner(over: Partial<FlowOwner> = {}): FlowOwner {
  return { kind: 'CLASS', id: 'run-1', name: 'Spring Puppy Class', href: '/classes/run-1', ...over }
}

function step(over: Partial<IndexedStep> = {}): IndexedStep {
  return {
    id: 's1',
    kind: 'MESSAGE',
    actor: 'CLIENT',
    trigger: null,
    direction: 'BEFORE_SESSION',
    offsetMinutes: 1440,
    blocking: false,
    channels: ['PUSH'],
    title: 'See you tomorrow',
    body: 'Reminder',
    payload: null,
    enabled: true,
    order: 0,
    ...over,
  }
}

/** A person-anchored (journey) step, as a Form's flow holds them. */
function journeyStep(over: Partial<IndexedStep> = {}): IndexedStep {
  return step({ trigger: 'ON_ENQUIRY_SUBMITTED', offsetMinutes: 0, ...over })
}

describe('what a flow says it does', () => {
  it('reuses the builder’s own words for every step', () => {
    const flow = summariseFlow(
      owner(),
      [step({ id: 's1', kind: 'FORM', title: null, body: null, payload: { formId: 'f1' } })],
      { forms: { f1: 'Pre-class questions' } },
    )
    // flowStepWhatText, not a second phrasing invented for this screen.
    expect(flow.rows[0].what).toBe('Send form: Pre-class questions')
  })

  it('counts the steps and the live ones', () => {
    const flow = summariseFlow(owner(), [
      step({ id: 'a' }),
      step({ id: 'b', enabled: false }),
      step({ id: 'c' }),
    ])
    expect(flow.steps).toBe(3)
    expect(flow.liveSteps).toBe(2)
    expect(flow.off).toBe(false)
  })
})

// A flow has no on/off switch of its own — each STEP has one — so "this whole
// thing is off" has to be derived, and it looks identical to a working flow
// from the offering page it was built on.
describe('a flow that is off', () => {
  it('is flagged when every step is switched off', () => {
    const flow = summariseFlow(owner(), [step({ id: 'a', enabled: false }), step({ id: 'b', enabled: false })])
    expect(flow.off).toBe(true)
    expect(flow.liveSteps).toBe(0)
  })

  it('is NOT flagged while one step still runs', () => {
    const flow = summariseFlow(owner(), [step({ id: 'a', enabled: false }), step({ id: 'b' })])
    expect(flow.off).toBe(false)
  })

  it('is not claimed about a flow with no steps at all', () => {
    expect(summariseFlow(owner(), []).off).toBe(false)
  })
})

// The SAME call the engine makes before it does anything (flowStepConfigProblem
// via flowStepSummary), so a step the cron will silently skip is a step this
// page visibly flags. A trainer finding out from the absence of an email is the
// failure being closed.
describe('a step the engine will skip', () => {
  it('names the reason, from the engine’s own gate', () => {
    const flow = summariseFlow(owner(), [
      step({ id: 'broken', kind: 'FORM', title: null, body: null, payload: {} }),
    ])
    expect(flow.problems).toHaveLength(1)
    expect(flow.problems[0].problem).toBe('No form chosen')
  })

  it('catches a MESSAGE with no copy too', () => {
    const flow = summariseFlow(owner(), [step({ id: 'empty', title: null, body: null })])
    expect(flow.problems[0].problem).toBe('This message has no copy')
  })

  it('says nothing about a step that is switched OFF', () => {
    // The engine skips it either way, so warning about it would put a fault on
    // a flow doing exactly what the trainer asked.
    const flow = summariseFlow(owner(), [
      step({ id: 'broken', kind: 'FORM', title: null, body: null, payload: {}, enabled: false }),
      step({ id: 'fine' }),
    ])
    expect(flow.problems).toHaveLength(0)
  })

  it('leaves a properly configured flow clean', () => {
    const flow = summariseFlow(owner(), [step({ id: 'ok', kind: 'FORM', title: null, body: null, payload: { formId: 'f1' } })])
    expect(flow.problems).toEqual([])
  })
})

// A trainer opening a flow from here must see the rows in the order the editor
// will show them, or the index is describing a different flow from the one they
// land on. Same rule as comms-flow-editor's `ordered`.
describe('the order the steps read in', () => {
  it('a journey reads in the order the trainer arranged it', () => {
    const rows = orderFlowSteps([
      journeyStep({ id: 'third', order: 2 }),
      journeyStep({ id: 'first', order: 0 }),
      journeyStep({ id: 'second', order: 1 }),
    ])
    expect(rows.map(r => r.id)).toEqual(['first', 'second', 'third'])
  })

  it('a clock-anchored flow reads in the order it will fire', () => {
    const rows = orderFlowSteps([
      step({ id: 'after', direction: 'AFTER_SESSION', offsetMinutes: 120, order: 0 }),
      step({ id: 'day-before', direction: 'BEFORE_SESSION', offsetMinutes: 1440, order: 1 }),
      step({ id: 'just-before', direction: 'BEFORE_SESSION', offsetMinutes: 15, order: 2 }),
    ])
    expect(rows.map(r => r.id)).toEqual(['day-before', 'just-before', 'after'])
  })

  it('numbers a journey’s steps so only the first names its trigger', () => {
    const flow = summariseFlow(owner({ kind: 'FORM' }), [
      journeyStep({ id: 'a', order: 0 }),
      journeyStep({ id: 'b', order: 1 }),
    ])
    expect(flow.rows[0].line).toBe('As soon as they enquire')
    expect(flow.rows[1].line).toBe('Once the step before is done')
  })
})

describe('grouping every flow onto one page', () => {
  const flows = [
    { owner: owner({ kind: 'FORM', id: 'f2', name: 'Website enquiry', href: '/forms/client/f2' }), steps: [step()] },
    { owner: owner({ kind: 'CLASS', id: 'r2', name: 'Zoomies', href: '/classes/r2' }), steps: [step()] },
    { owner: owner({ kind: 'CLASS', id: 'r1', name: 'Adolescent', href: '/classes/r1' }), steps: [step()] },
    { owner: owner({ kind: 'MEMBERSHIP', id: 'm1', name: 'Gold', href: '/memberships' }), steps: [step()] },
  ]

  it('sorts by section first, then by name', () => {
    const index = buildFlowIndex(flows)
    expect(index.map(f => f.owner.name)).toEqual(['Adolescent', 'Zoomies', 'Gold', 'Website enquiry'])
  })

  it('drops a parent that has no steps — nothing was built, so there is nothing to see', () => {
    const index = buildFlowIndex([
      ...flows,
      { owner: owner({ kind: 'CLASS', id: 'empty', name: 'Never automated', href: '/classes/empty' }), steps: [] },
    ])
    expect(index.map(f => f.owner.id)).not.toContain('empty')
  })

  it('splits the sections and skips the empty ones', () => {
    const sections = groupFlowsBySection(buildFlowIndex(flows))
    expect(sections.map(s => s.kind)).toEqual(['CLASS', 'MEMBERSHIP', 'FORM'])
    expect(sections[0].flows).toHaveLength(2)
  })

  it('every owner kind has a section, or its flows would vanish off the page', () => {
    const kinds = FLOW_OWNER_SECTIONS.map(s => s.kind)
    for (const kind of ['CLASS', 'CASUAL', 'EVENT', 'DAYCARE', 'PACKAGE', 'MEMBERSHIP', 'FORM'] as const) {
      expect(kinds, kind).toContain(kind)
    }
  })
})

describe('the line under the title', () => {
  it('reads as a plain count when nothing is wrong', () => {
    const index = buildFlowIndex([
      { owner: owner({ id: 'a' }), steps: [step()] },
      { owner: owner({ id: 'b' }), steps: [step()] },
    ])
    expect(flowIndexHeadline(index)).toBe('2 automations')
  })

  it('calls out the ones that are off and the ones that need setting up', () => {
    const index = buildFlowIndex([
      { owner: owner({ id: 'a' }), steps: [step({ enabled: false })] },
      { owner: owner({ id: 'b' }), steps: [step({ kind: 'FORM', title: null, body: null, payload: {} })] },
      { owner: owner({ id: 'c' }), steps: [step()] },
    ])
    expect(flowIndexHeadline(index)).toBe('3 automations · 1 off · 1 needs setting up')
  })

  it('says so when there is nothing at all', () => {
    expect(flowIndexHeadline([])).toBe('Nothing automated yet')
  })
})

// The index is a WAY IN, not a replacement. A second editor would be two places
// to change a step and two places for the rules to drift.
describe('the page does not become a second editor', () => {
  const view = readFileSync(
    resolve(__dirname, '../../src/app/(trainer)/automations/automations-view.tsx'),
    'utf8',
  )

  it('renders no flow editor of its own', () => {
    expect(view).not.toContain('CommsFlowEditor')
    expect(view).not.toContain('comms-flow-editor')
  })

  it('writes nothing — no form, no fetch, no client component', () => {
    expect(view).not.toContain("'use client'")
    expect(view).not.toContain('fetch(')
    expect(view).not.toContain('method: ')
  })

  it('phrases the steps with the shared summary rather than its own words', () => {
    const lib = readFileSync(resolve(__dirname, '../../src/lib/flow-index.ts'), 'utf8')
    expect(lib).toContain('flowStepSummary')
  })
})
