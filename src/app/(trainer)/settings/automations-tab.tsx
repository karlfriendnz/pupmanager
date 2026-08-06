import { prisma } from '@/lib/prisma'
import { can, type PermissionMap } from '@/lib/permissions'
import type { CompanyRole } from '@/generated/prisma'
import { runKind, runHref, type RunKindPackage } from '@/lib/run-kind'
import { safeFlowStepPayload, type FlowStepKind } from '@/lib/comms-flow-steps'
import {
  buildFlowIndex,
  buildOwnerChoices,
  FLOW_OWNER_KIND_BY_RUN_KIND,
  FLOW_OWNER_PERMISSION,
  type FlowOwner,
  type FlowOwnerKind,
  type IndexedStep,
} from '@/lib/flow-index'
import type { FlowStepNames } from '@/lib/flow-step-summary'
import { AutomationsPanel } from './automations-panel'

/**
 * Settings → Automations. Everything this business sends on its own, in one
 * place, and editable from here.
 *
 * The flow builder mounts on FIVE different screens — a class run, a 1:1
 * package, an event, a membership and a form — so a trainer could only see what
 * they had automated by opening every offering one at a time. Karl: "the
 * automations page should have a list of all the automations - it should be in
 * the settings area and should a way to edit the automation from here."
 *
 * Settings, because this is configuration of how the business behaves rather
 * than a place a trainer does daily work. It sits directly after Forms: a form
 * is where a journey's flow lives, so "the questions you ask" and "the things
 * that go out on their own" read as neighbours.
 *
 * NO second editor. The panel mounts `CommsFlowEditor` — the same component,
 * with the same props, writing to the same four CRUD trees as the offering
 * pages, which keep theirs exactly where they are.
 *
 * It also STARTS one (Karl, on the finished index: "why can't i do this from
 * the automations page?"). There is nothing to create — a flow is its steps —
 * so the second query below fetches what a flow could hang off, and picking one
 * opens the same editor on it. Nothing is written until the first step saves.
 */

/** The four shapes a run can take, mapped to the section it is listed under.
 *  Shared with the timeline page, which has to reach the same answer. */
const RUN_KIND_SECTION = FLOW_OWNER_KIND_BY_RUN_KIND

/**
 * Can this person edit flows of ANY kind? Asked by the settings page before it
 * renders the tab at all, so nobody gets a menu row leading to an empty screen.
 */
export function canSeeAutomations(role: CompanyRole, permissions: PermissionMap): boolean {
  return Object.values(FLOW_OWNER_PERMISSION).some(p => can(p, role, permissions))
}

export async function AutomationsTab({
  companyId,
  role,
  permissions,
}: {
  companyId: string
  role: CompanyRole
  permissions: PermissionMap
}) {
  const trainerId = companyId

  // Every step this business owns, whichever of the four parents it hangs off.
  // Scoped through the PARENT's trainerId in all four cases — a step carries no
  // tenant of its own, so filtering on the step alone would return everybody's.
  const steps = await prisma.commsFlowStep.findMany({
    where: {
      OR: [
        { classRun: { trainerId } },
        { package: { trainerId } },
        { membership: { trainerId } },
        { form: { trainerId } },
      ],
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, kind: true, actor: true, trigger: true, direction: true, offsetMinutes: true,
      blocking: true, channels: true, title: true, body: true, payload: true, enabled: true, order: true,
      classRun: {
        select: {
          id: true, name: true,
          // What KIND of run it is, so the row links to the section the trainer
          // actually finds it under. Nothing on the run says which; only the
          // backing package does (see lib/run-kind.ts).
          package: { select: { isEvent: true, allowDropIn: true, isPuppySchool: true } },
        },
      },
      package: { select: { id: true, name: true } },
      membership: { select: { id: true, name: true } },
      form: { select: { id: true, name: true } },
    },
  })

  // ── The names a step's payload only holds an id for ───────────────────────
  // Resolved here and handed to the summary, which stays pure and never
  // fetches. Scoped to ids these steps actually reference AND to this trainer:
  // a step naming somebody else's form must read as "not chosen yet" rather
  // than leaking what they called it.
  const formIds = new Set<string>()
  const taskIds = new Set<string>()
  const offeringIds = new Set<string>()
  for (const s of steps) {
    const kind = s.kind as FlowStepKind
    if (kind === 'FORM') {
      const id = safeFlowStepPayload('FORM', s.payload).payload.formId
      if (id) formIds.add(id)
    } else if (kind === 'TASK') {
      const id = safeFlowStepPayload('TASK', s.payload).payload.libraryTaskId
      if (id) taskIds.add(id)
    } else if (kind === 'CHOOSE_OFFERING') {
      for (const id of safeFlowStepPayload('CHOOSE_OFFERING', s.payload).payload.packageIds ?? []) {
        offeringIds.add(id)
      }
    }
  }

  const [namedForms, namedTasks, namedOfferings] = await Promise.all([
    formIds.size
      ? prisma.form.findMany({ where: { id: { in: [...formIds] }, trainerId }, select: { id: true, name: true } })
      : [],
    taskIds.size
      // Only the CATEGORY carries the tenant, exactly as
      // /api/trainer/flow-options resolves it. The item links to its category
      // directly, so an item with no theme is named here too.
      ? prisma.libraryTask.findMany({
          where: { id: { in: [...taskIds] }, type: { trainerId } },
          select: { id: true, title: true },
        })
      : [],
    offeringIds.size
      ? prisma.package.findMany({ where: { id: { in: [...offeringIds] }, trainerId }, select: { id: true, name: true } })
      : [],
  ])

  const names: FlowStepNames = {
    forms: Object.fromEntries(namedForms.map(f => [f.id, f.name])),
    tasks: Object.fromEntries(namedTasks.map(t => [t.id, t.title])),
    offerings: Object.fromEntries(namedOfferings.map(p => [p.id, p.name])),
  }

  // ── Group by the thing each step hangs off ────────────────────────────────
  const byOwner = new Map<string, { owner: FlowOwner; steps: IndexedStep[] }>()
  for (const s of steps) {
    const owner = ownerOf(s)
    // A step whose parent was deleted out from under it has nothing to list.
    if (!owner) continue
    // Nothing this person could not also save. The flow routes each guard on
    // their own permission, so listing a flow whose editor would 403 on the
    // first change is worse than not listing it (FLOW_OWNER_PERMISSION).
    if (!can(FLOW_OWNER_PERMISSION[owner.kind], role, permissions)) continue
    const key = `${owner.kind}:${owner.id}`
    const entry = byOwner.get(key) ?? { owner, steps: [] }
    entry.steps.push({
      id: s.id,
      kind: s.kind as IndexedStep['kind'],
      actor: s.actor as IndexedStep['actor'],
      trigger: s.trigger as IndexedStep['trigger'],
      direction: s.direction,
      offsetMinutes: s.offsetMinutes,
      blocking: s.blocking,
      channels: s.channels as string[],
      title: s.title,
      body: s.body,
      payload: s.payload,
      enabled: s.enabled,
      order: s.order,
    })
    byOwner.set(key, entry)
  }

  const flows = buildFlowIndex([...byOwner.values()], names)

  // ── What a NEW automation could hang off ──────────────────────────────────
  // Karl: "why can't i do this from the automations page?" Nothing is created
  // by picking one — a flow IS its steps, so this only decides which editor to
  // open. See buildOwnerChoices.
  //
  // Each query is skipped outright for someone who could not save a step on
  // that kind, so the rows never leave the database, and buildOwnerChoices
  // applies the same rule again over the top.
  const allow = (kind: FlowOwnerKind) => can(FLOW_OWNER_PERMISSION[kind], role, permissions)

  const [runs, oneToOnes, memberships, forms] = await Promise.all([
    allow('CLASS')
      ? prisma.classRun.findMany({
          // A finished or called-off run cannot send anything, so offering it is
          // offering a thing that will never fire.
          where: { trainerId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, package: { select: { isEvent: true, allowDropIn: true, isPuppySchool: true } } },
        })
      : [],
    allow('PACKAGE')
      // 1:1 packages only. A GROUP package's flow hangs off its run, not off the
      // package — the offering page mounts the editor on exactly this condition.
      ? prisma.package.findMany({
          where: { trainerId, isGroup: false },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        })
      : [],
    allow('MEMBERSHIP')
      ? prisma.membership.findMany({ where: { trainerId }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
      : [],
    allow('FORM')
      ? prisma.form.findMany({ where: { trainerId }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
      : [],
  ])

  const candidates: FlowOwner[] = [
    ...runs.map(r => ({
      kind: RUN_KIND_SECTION[runKind(r.package)],
      id: r.id,
      name: r.name,
      href: runHref(r.id, r.package),
    })),
    ...oneToOnes.map(p => ({ kind: 'PACKAGE' as const, id: p.id, name: p.name, href: `/packages/${p.id}` })),
    ...memberships.map(m => ({ kind: 'MEMBERSHIP' as const, id: m.id, name: m.name, href: '/memberships' })),
    ...forms.map(f => ({ kind: 'FORM' as const, id: f.id, name: f.name, href: `/forms/client/${f.id}` })),
  ]

  return <AutomationsPanel flows={flows} choices={buildOwnerChoices(candidates, flows, allow)} />
}

type StepRow = {
  classRun: { id: string; name: string; package: RunKindPackage } | null
  package: { id: string; name: string } | null
  membership: { id: string; name: string } | null
  form: { id: string; name: string } | null
}

/** Which of the four parents this step belongs to, and where its own page is. */
function ownerOf(step: StepRow): FlowOwner | null {
  if (step.classRun) {
    return {
      kind: RUN_KIND_SECTION[runKind(step.classRun.package)],
      id: step.classRun.id,
      name: step.classRun.name,
      // runHref, not a hand-built path: a run's detail screen lives under
      // whichever of the four sections it belongs to, and every caller that
      // worked that out locally eventually got it wrong.
      href: runHref(step.classRun.id, step.classRun.package),
    }
  }
  if (step.package) {
    return { kind: 'PACKAGE', id: step.package.id, name: step.package.name, href: `/packages/${step.package.id}` }
  }
  if (step.membership) {
    // Memberships have no per-id route — their own editor opens inside the list.
    return { kind: 'MEMBERSHIP', id: step.membership.id, name: step.membership.name, href: '/memberships' }
  }
  if (step.form) {
    return { kind: 'FORM', id: step.form.id, name: step.form.name, href: `/forms/client/${step.form.id}` }
  }
  return null
}
