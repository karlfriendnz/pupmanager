import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { runKind, runHref, type RunKindPackage } from '@/lib/run-kind'
import { safeFlowStepPayload, type FlowStepKind } from '@/lib/comms-flow-steps'
import { buildFlowIndex, type FlowOwner, type FlowOwnerKind, type IndexedStep } from '@/lib/flow-index'
import type { FlowStepNames } from '@/lib/flow-step-summary'
import { AutomationsView } from './automations-view'

export const metadata: Metadata = { title: 'Automations' }

/**
 * Everything this business sends on its own, on one screen.
 *
 * The builder mounts in five separate places — a class run, a 1:1 package, an
 * event, a membership and a form — so until now a trainer could only see what
 * they had automated by visiting every offering one at a time. Karl: "is there
 * a page somewhere where we can see all the automations?"
 *
 * A ROUTE of its own rather than a tab, which is the standing rule for adjunct
 * features, because this one spans five different objects and there is no
 * single page it could hang off without picking a favourite.
 *
 * Read-only, and deliberately: every row links to the editor in ITS EXISTING
 * HOME. Building a second editor here would be two places to change a step and
 * two places for the rules to drift.
 *
 * No per-permission gate, for the reason /api/trainer/flow-options gives: the
 * editors it links to sit behind THREE different permissions (classes.manage,
 * packages.manage, settings.edit), so gating the index on any one of them would
 * hide half a trainer's own automations from the person who built them. What is
 * on the page is names and the business's own outbound copy — no client data,
 * no URLs, nothing worth more than the labels. The links themselves still land
 * on screens that check.
 */

/** The four shapes a run can take, mapped to the section it is listed under. */
const RUN_KIND_SECTION: Record<ReturnType<typeof runKind>, FlowOwnerKind> = {
  class: 'CLASS',
  casual: 'CASUAL',
  event: 'EVENT',
  daycare: 'DAYCARE',
}

export default async function AutomationsPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

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
      classRunId: true, packageId: true, membershipId: true, formId: true,
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
      // The library is a type → theme → task tree and only the TYPE carries the
      // tenant, exactly as /api/trainer/flow-options resolves it.
      ? prisma.libraryTask.findMany({
          where: { id: { in: [...taskIds] }, theme: { type: { trainerId } } },
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

  return (
    <>
      <PageHeader title="Automations" />
      <AutomationsView flows={buildFlowIndex([...byOwner.values()], names)} />
    </>
  )
}

type StepRow = {
  classRun: { id: string; name: string; package: RunKindPackage } | null
  package: { id: string; name: string } | null
  membership: { id: string; name: string } | null
  form: { id: string; name: string } | null
}

/** Which of the four parents this step belongs to, and where its editor lives. */
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
    // Memberships have no per-id route — their editor opens inside the list,
    // which is where this takes the trainer.
    return { kind: 'MEMBERSHIP', id: step.membership.id, name: step.membership.name, href: '/memberships' }
  }
  if (step.form) {
    return { kind: 'FORM', id: step.form.id, name: step.form.name, href: `/forms/client/${step.form.id}` }
  }
  return null
}
