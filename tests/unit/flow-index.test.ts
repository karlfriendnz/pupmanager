import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  buildFlowIndex,
  buildOwnerChoices,
  groupOwnerChoicesBySection,
  summariseFlow,
  orderFlowSteps,
  groupFlowsBySection,
  flowIndexHeadline,
  flowEditorTarget,
  flowSectionLabel,
  ownerKey,
  FLOW_OWNER_SECTIONS,
  FLOW_OWNER_PERMISSION,
  type FlowOwner,
  type FlowOwnerKind,
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

// ── Editing from Settings, through the SAME editor ──────────────────────────
//
// Karl moved this into Settings and asked to edit from it. The rule that makes
// that safe is that there is exactly ONE editor: the Settings panel mounts
// `CommsFlowEditor`, the same component the five offering pages mount, with the
// same props and therefore the same four CRUD trees. A second editing UI would
// be two places to change a step and two places for the flow rules — which
// kinds may block, which steps the engine skips — to drift.

const file = (rel: string) => readFileSync(resolve(__dirname, '../../', rel), 'utf8')

describe('one editor, mounted from two places', () => {
  const panel = file('src/app/(trainer)/settings/automations-panel.tsx')

  // No accordion any more (Karl, 2026-08-06): the panel is a list that leads to
  // each flow's own page, which is where the editor lives. So the panel must
  // NOT mount an editor — expanding here would mean editing in the narrower of
  // the two places with the rest of Settings still on screen.
  it('the Settings panel leads to the flow page rather than editing in place', () => {
    expect(panel).not.toContain('<CommsFlowEditor')
    expect(panel).toContain('flowTimelineHref(')
  })

  it('the panel writes nothing itself — every change goes through the editor', () => {
    // No second write path. The panel navigates and refreshes; it never posts.
    expect(panel).not.toContain('fetch(')
    expect(panel).not.toContain("method: 'POST'")
    expect(panel).not.toContain("method: 'PATCH'")
    expect(panel).not.toContain("method: 'DELETE'")
  })

  // The editor derives its ENTIRE api base from which id prop is set, so
  // handing it the right one is the whole difference between the two mount
  // points. Exactly one key, or it would write to whichever branch its `?:`
  // chain reached first.
  it('points the editor at the right tree, one id at a time', () => {
    expect(flowEditorTarget({ kind: 'CLASS', id: 'r1' })).toEqual({ runId: 'r1' })
    expect(flowEditorTarget({ kind: 'CASUAL', id: 'r2' })).toEqual({ runId: 'r2' })
    expect(flowEditorTarget({ kind: 'EVENT', id: 'r3' })).toEqual({ runId: 'r3' })
    expect(flowEditorTarget({ kind: 'DAYCARE', id: 'r4' })).toEqual({ runId: 'r4' })
    expect(flowEditorTarget({ kind: 'PACKAGE', id: 'p1' })).toEqual({ packageId: 'p1' })
    expect(flowEditorTarget({ kind: 'MEMBERSHIP', id: 'm1' })).toEqual({ membershipId: 'm1' })
    expect(flowEditorTarget({ kind: 'FORM', id: 'f1' })).toEqual({ formId: 'f1' })
  })

  it('never hands the editor two ids at once', () => {
    for (const kind of FLOW_OWNER_SECTIONS.map(s => s.kind)) {
      const target = flowEditorTarget({ kind, id: 'x' })
      expect(Object.keys(target), kind).toHaveLength(1)
    }
  })

  // The prop each offering page ALREADY passes. If one of them changed shape,
  // Settings would be pointing the same editor somewhere else.
  it('uses the same prop the offering page uses for that kind', () => {
    const mounts: [FlowOwnerKind, string, string][] = [
      ['CLASS', 'src/app/(trainer)/classes/[runId]/run-detail.tsx', 'runId'],
      ['EVENT', 'src/app/(trainer)/events/[eventId]/event-detail.tsx', 'runId'],
      ['PACKAGE', 'src/app/(trainer)/packages/[packageId]/package-detail.tsx', 'packageId'],
      ['MEMBERSHIP', 'src/app/(trainer)/memberships/memberships-view.tsx', 'membershipId'],
      ['FORM', 'src/app/(trainer)/forms/client/client-form-editor.tsx', 'formId'],
    ]
    for (const [kind, path, prop] of mounts) {
      const src = file(path)
      // The offering page still mounts the editor, and still mounts it there.
      expect(src, `${path} must still mount the editor`).toContain('<CommsFlowEditor')
      expect(src, `${path} passes ${prop}`).toMatch(new RegExp(`${prop}=\\{`))
      // …and Settings targets the editor with exactly that prop.
      expect(Object.keys(flowEditorTarget({ kind, id: 'x' })), kind).toEqual([prop])
    }
  })

  // The editors on the offering pages stay exactly where they are — nothing
  // moved off them when Settings gained its own way in.
  it('leaves all five offering-page editors in place', () => {
    const homes = [
      'src/app/(trainer)/classes/[runId]/run-detail.tsx',
      'src/app/(trainer)/events/[eventId]/event-detail.tsx',
      'src/app/(trainer)/packages/[packageId]/package-detail.tsx',
      'src/app/(trainer)/memberships/memberships-view.tsx',
      'src/app/(trainer)/forms/client/client-form-editor.tsx',
    ]
    for (const home of homes) expect(file(home), home).toContain('CommsFlowEditor')
  })

  it('phrases the steps with the shared summary rather than its own words', () => {
    expect(file('src/lib/flow-index.ts')).toContain('flowStepSummary')
  })
})

// "Off" and "needs setting up" are DERIVED on the server, so an edit made from
// Settings would leave them stale. The editor reports every successful write
// from `api()` — the one place it writes anything — and the panel refreshes.
describe('the list stays fresh after an edit', () => {
  const editor = file('src/components/trainer/comms-flow-editor.tsx')
  const panel = file('src/app/(trainer)/settings/automations-panel.tsx')

  it('the editor reports a change from its single write helper', () => {
    // One call site, inside api(), so no mutation can be added that forgets it.
    expect(editor.match(/onChanged\?\.\(\)/g) ?? []).toHaveLength(1)
    const api = editor.slice(editor.indexOf('async function api('), editor.indexOf('async function addStep('))
    expect(api).toContain('onChanged?.()')
    // …after the response was checked, so a failed save reports nothing.
    expect(api.indexOf('if (!res.ok)')).toBeLessThan(api.indexOf('onChanged?.()'))
  })

  it('every mutation still goes through that one helper', () => {
    // If a raw fetch with a method ever appears outside api(), onChanged (and
    // the refresh behind it) silently stops covering it.
    const raw = [...editor.matchAll(/fetch\(/g)]
    // Three reads in load(), plus the single one inside api().
    expect(raw).toHaveLength(4)
  })

  // Nothing is edited here now, so there is nothing to refresh: the flow page
  // is a route of its own and arrives with fresh server data every time.
  it('the panel navigates rather than refreshing itself', () => {
    expect(panel).toContain('useRouter')
    expect(panel).toContain('router.push(')
  })
})

// The index may only offer a flow this person could also SAVE. An editor that
// loads and then 403s on the first change is worse than not showing the flow.
describe('what the tab offers matches what the API will accept', () => {
  const routeFor: Record<FlowOwnerKind, string> = {
    CLASS: 'src/app/api/trainer/class-runs/[runId]/comms-flow/route.ts',
    CASUAL: 'src/app/api/trainer/class-runs/[runId]/comms-flow/route.ts',
    EVENT: 'src/app/api/trainer/class-runs/[runId]/comms-flow/route.ts',
    DAYCARE: 'src/app/api/trainer/class-runs/[runId]/comms-flow/route.ts',
    PACKAGE: 'src/app/api/trainer/packages/[packageId]/comms-flow/route.ts',
    MEMBERSHIP: 'src/app/api/trainer/memberships/[id]/comms-flow/route.ts',
    FORM: 'src/app/api/trainer/forms/[formId]/comms-flow/route.ts',
  }

  it('names the permission each kind’s own route actually guards on', () => {
    for (const [kind, path] of Object.entries(routeFor) as [FlowOwnerKind, string][]) {
      const guards = [...file(path).matchAll(/guardPermission\('([^']+)'\)/g)].map(m => m[1])
      expect(guards.length, `${path} should guard its writes`).toBeGreaterThan(0)
      // Every guard in the file agrees, and it is the one the tab filters on.
      expect(new Set(guards), path).toEqual(new Set([FLOW_OWNER_PERMISSION[kind]]))
    }
  })

  it('answers for every kind that can appear on the page', () => {
    for (const { kind } of FLOW_OWNER_SECTIONS) {
      expect(FLOW_OWNER_PERMISSION[kind], kind).toBeTruthy()
    }
  })

  it('the tab filters the list by that permission', () => {
    const tab = file('src/app/(trainer)/settings/automations-tab.tsx')
    expect(tab).toContain('FLOW_OWNER_PERMISSION[owner.kind]')
  })
})

// It shipped as a top-level nav item. A dead URL for a screen that still exists
// is the worst version of moving something.
describe('the old top-level route', () => {
  const page = file('src/app/(trainer)/automations/page.tsx')

  it('redirects to the new home rather than 404ing', () => {
    expect(page).toContain("redirect('/settings?tab=automations')")
  })

  it('is gone from the menu, and from the rename catalogue with it', () => {
    // The catalogue mirrors the real menu and is drift-tested against it, so a
    // stale row here fails tests/unit/nav-labels.test.ts.
    expect(file('src/components/shared/app-shell.tsx')).not.toContain("'/automations'")
    expect(file('src/lib/nav-labels.ts')).not.toContain("'/automations'")
  })
})

// ── Starting one ─────────────────────────────────────────────────────────────
//
// Karl, on the finished index: "why can't i do this from the automations page?"
//
// The thing to keep straight is that there is nothing to CREATE. A flow is steps
// hanging off a class, a package, a membership or a form — it has no row and no
// id of its own — so "new" is a picker of owners and then the same editor, and
// the three ways it can go wrong are: offering an owner whose routes will refuse
// the first step, starting a SECOND flow on something that already has one, and
// leaving the placeholder on screen after the real row arrives.

const CLASS_RUN = owner({ kind: 'CLASS', id: 'run-1', name: 'Puppy Class' })
const PACKAGE = owner({ kind: 'PACKAGE', id: 'pkg-1', name: 'Ada 1:1', href: '/packages/pkg-1' })
const FORM = owner({ kind: 'FORM', id: 'form-1', name: 'Intake', href: '/forms/client/form-1' })

describe('what a new automation can hang off', () => {
  it('offers only owners this person could also save a step on', () => {
    const choices = buildOwnerChoices(
      [CLASS_RUN, PACKAGE, FORM],
      [],
      // A staff member who may edit offerings but not classes or settings.
      kind => FLOW_OWNER_PERMISSION[kind] === 'packages.manage',
    )
    expect(choices.map(c => c.owner.id)).toEqual(['pkg-1'])
  })

  it('offers everything when nothing is withheld', () => {
    const choices = buildOwnerChoices([CLASS_RUN, PACKAGE, FORM], [])
    expect(choices).toHaveLength(3)
    expect(choices.every(c => !c.hasFlow)).toBe(true)
  })

  // Filtering it out would mean the one class a trainer is looking for is
  // missing with no explanation. Marked, the row says why and still opens it.
  it('still lists an owner that already has a flow, marked', () => {
    const flows = buildFlowIndex([{ owner: CLASS_RUN, steps: [step()] }])
    const choices = buildOwnerChoices([CLASS_RUN, PACKAGE], flows)
    expect(choices.find(c => c.owner.id === 'run-1')?.hasFlow).toBe(true)
    expect(choices.find(c => c.owner.id === 'pkg-1')?.hasFlow).toBe(false)
  })

  // The key is what makes "already has one" a lookup rather than a guess — and
  // an id alone is only unique within its own table.
  it('tells two owners apart by kind as well as id', () => {
    expect(ownerKey({ kind: 'CLASS', id: 'x' })).not.toBe(ownerKey({ kind: 'FORM', id: 'x' }))
    const flows = buildFlowIndex([{ owner: owner({ kind: 'FORM', id: 'run-1' }), steps: [step()] }])
    // Same id, different kind: the class must NOT be marked as having a flow.
    expect(buildOwnerChoices([CLASS_RUN], flows)[0].hasFlow).toBe(false)
  })

  it('reads in the same order and under the same headings as the list', () => {
    const choices = buildOwnerChoices([FORM, PACKAGE, CLASS_RUN], [])
    const sections = groupOwnerChoicesBySection(choices)
    expect(sections.map(s => s.label)).toEqual(['Group classes', '1:1 sessions', 'Forms'])
    // The same labels the list's own sections use — one source, so a trainer who
    // picked something under "Group classes" finds it under "Group classes".
    for (const s of sections) expect(s.label).toBe(flowSectionLabel(s.kind))
  })

  it('sorts by name inside a section, like the list does', () => {
    const zed = owner({ kind: 'CLASS', id: 'run-2', name: 'Zoomies' })
    const abe = owner({ kind: 'CLASS', id: 'run-3', name: 'Adolescents' })
    expect(buildOwnerChoices([zed, abe], []).map(c => c.owner.name)).toEqual(['Adolescents', 'Zoomies'])
  })

  it('skips a section with nothing in it', () => {
    expect(groupOwnerChoicesBySection(buildOwnerChoices([PACKAGE], []))).toHaveLength(1)
  })
})

describe('the picker, on screen', () => {
  const panel = file('src/app/(trainer)/settings/automations-panel.tsx')
  const tab = file('src/app/(trainer)/settings/automations-tab.tsx')

  it('takes the whole screen rather than hanging off a corner', () => {
    // AGENTS.md: more than ~3 choices is a full screen. FullScreenSheet is the
    // house one, and carries the body-scroll lock and no-scrollbar with it, so
    // a hand-rolled overlay here would be the two-scrollbars bug waiting.
    expect(panel).toContain('FullScreenSheet')
    expect(panel).toContain('New automation')
  })

  it('sends the chosen owner to that flow\'s own page', () => {
    // One destination for every owner, new or existing. A flow has no identity
    // beyond what it hangs off, so an owner already in the list cannot get a
    // second one — the same href simply opens what is there.
    const choose = panel.slice(panel.indexOf('function choose('))
    expect(choose.slice(0, 400)).toContain('flowTimelineHref(owner')
    expect(panel).not.toContain('setPending')
  })

  it('the tab filters the picker by the same permission as the list', () => {
    expect(tab).toContain('FLOW_OWNER_PERMISSION[kind]')
    expect(tab).toContain('buildOwnerChoices(candidates, flows, allow)')
  })

  // A group package's flow hangs off its RUN, not off the package — the package
  // page mounts the editor on exactly that condition. Offering both would give a
  // trainer two doors to one class, writing to two different trees.
  it('offers 1:1 packages only, matching where the editor actually mounts', () => {
    expect(tab).toContain('isGroup: false')
    expect(file('src/app/(trainer)/packages/[packageId]/package-detail.tsx')).toContain('!pkg.isGroup')
  })

  // A finished or called-off run cannot send anything.
  it('leaves out runs that are over', () => {
    expect(tab).toContain("status: { notIn: ['COMPLETED', 'CANCELLED'] }")
  })
})
