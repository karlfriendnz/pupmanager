import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { PageHeader } from '@/components/shared/page-header'
import { SetPageImmersive } from '@/components/shared/page-title'

import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { runKind, runHref } from '@/lib/run-kind'
import { CommsFlowEditor } from '@/components/trainer/comms-flow-editor'
import {
  flowEditorTarget,
  flowSectionLabel,
  FLOW_OWNER_KIND_BY_RUN_KIND,
  FLOW_OWNER_PERMISSION,
  type FlowOwner,
  type FlowTimelineSegment,
} from '@/lib/flow-index'

/**
 * One automation, on a page of its own.
 *
 * Karl: "can the automation flow look like a timeline, can it also be opened up
 * on a new page to remove distraction from the user". So: no offering tabs, no
 * settings chrome, no roster underneath — the flow's name, a way back, and the
 * timeline.
 *
 * ── There is still ONE editor ───────────────────────────────────────────────
 *
 * This page mounts `CommsFlowEditor`, the same component the class page, the
 * package page, the event page, the memberships list, the form builder and the
 * Settings list all mount, pointed at the same CRUD tree by the same
 * `flowEditorTarget` map. The only thing it passes that they don't is
 * `fullPage`, which drops the component's own border and hides the link to the
 * page it is already on. A second editing UI would be two places to change a
 * step and two places for the flow rules to drift — and those rules (which
 * kinds may block, which steps the engine skips, what a gate is allowed to be)
 * are exactly the sort that punish it.
 *
 * The in-place mounts all stay. This is an option, not a replacement.
 *
 * ── Guarded exactly as editing in place is ──────────────────────────────────
 *
 * The four flow CRUD trees guard on THREE different permissions
 * (FLOW_OWNER_PERMISSION records which), so this page asks the same question
 * the Settings list asks before it offers a row: the permission for the kind of
 * thing this flow hangs off. Anything else and a trainer reaches an editor that
 * loads and then 403s on their first change.
 */
export const metadata: Metadata = { title: 'Automation' }

const SEGMENTS: FlowTimelineSegment[] = ['run', 'package', 'membership', 'form']

/** One client of this offering, as the editor's audience picker + preview want
 *  them. Same shape the offering pages already build. */
interface ClientOpt {
  id: string
  name: string
  dog: string | null
}

export default async function AutomationTimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ target: string; id: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')

  const { target, id } = await params
  if (!SEGMENTS.includes(target as FlowTimelineSegment)) notFound()

  const found = await resolveOwner(target as FlowTimelineSegment, id, ctx.companyId)
  // A 404 for something that belongs to somebody else, not a 403: whether this
  // trainer's neighbour runs a class called "Puppy Class 4" is not ours to
  // confirm. Same for a permission they don't hold — the Settings list simply
  // doesn't show them these, and neither does this.
  if (!found) notFound()
  if (!can(FLOW_OWNER_PERMISSION[found.owner.kind], ctx.role, ctx.permissions)) notFound()

  const { owner, location, clients } = found
  const back = safeReturnTo((await searchParams).from) ?? owner.href

  return (
    <>
      {/* The five bottom tabs stand down (Karl: "lets hide the nav"). Building
          an automation is a job you finish; the tabs offer to leave it, and the
          Save bar wants the floor. keepTopBar leaves the back arrow. */}
      <SetPageImmersive value keepTopBar />
      {/* The shell reserves 5rem at the foot of every phone screen for those
          tabs. They aren't here, so that reservation is a band of nothing. */}
      <style>{`@media (max-width: 767px) { .pm-main { padding-bottom: 0 !important; } }`}</style>

      {/* The page used to draw its OWN header row — a back arrow, the offering
          name and the section under it — while every other trainer screen gets
          that from PageHeader, which feeds the phone bar and the desktop top
          bar. That was the "move the header" half of Karl's note: one header,
          in the same place as everywhere else. */}
      <PageHeader
        title={owner.name}
        subtitle={flowSectionLabel(owner.kind)}
        back={{ href: back, label: 'Back' }}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-0 sm:px-4 sm:py-6" data-review-scope="Automation timeline">
        <div className="flex-1 border-t border-slate-200 sm:rounded-xl sm:border">
          <CommsFlowEditor
            {...flowEditorTarget(owner)}
            offeringName={owner.name}
            location={location}
            clients={clients}
            fullPage
          />
        </div>

        {/* The editor's own actions ("Save as template") land HERE, portaled in
            — at the FOOT of the page now rather than the top right of the
            header (Karl: "put the save template at the bottom"), which is also
            where every other screen's Save lives.
            The bar IS the portal target, so `empty:hidden` means it simply
            isn't there until the editor mounts and gives it something — an
            empty bordered strip across the bottom would be chrome for nothing.
            The button stays inside the editor, which is the only thing holding
            the api/load/runId it needs; a copy in this page would be a second
            implementation to keep in step. */}
        <div
          id="flow-header-actions"
          className="sticky bottom-0 z-30 flex items-center justify-end gap-2 border-t border-slate-200 bg-white/95 px-4 pt-3 backdrop-blur empty:hidden sm:px-0"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        />
      </div>
    </>
  )
}

/**
 * Where "Back" goes.
 *
 * Only an in-app path. `from` arrives in the URL, so anything else is an open
 * redirect wearing a Back button — and `//host` is a protocol-relative URL that
 * leaves the site while looking like a path.
 */
function safeReturnTo(from: string | undefined): string | null {
  if (!from || !from.startsWith('/') || from.startsWith('//')) return null
  return from
}

/**
 * The thing this flow hangs off — scoped to the signed-in company in every
 * branch, because a flow's own rows carry no tenant of their own.
 *
 * It also collects what the editor needs to be the SAME editor it is on the
 * offering page: the venue and the people booked, without which "Chosen people"
 * would offer nobody and the preview would show a stranger.
 */
async function resolveOwner(
  target: FlowTimelineSegment,
  id: string,
  trainerId: string,
): Promise<{ owner: FlowOwner; location: string | null; clients: ClientOpt[] } | null> {
  if (target === 'run') {
    const run = await prisma.classRun.findFirst({
      where: { id, trainerId },
      select: {
        id: true,
        name: true,
        location: true,
        // Which of the four sections it belongs to — nothing on the run says,
        // only the backing package does (lib/run-kind.ts).
        package: { select: { isEvent: true, allowDropIn: true, isPuppySchool: true } },
      },
    })
    if (!run) return null
    const enrolments = await prisma.classEnrollment.findMany({
      where: { classRunId: run.id, status: { not: 'WITHDRAWN' } },
      select: {
        clientId: true,
        client: { select: { user: { select: { name: true } } } },
        dog: { select: { name: true } },
      },
    })
    return {
      owner: {
        kind: FLOW_OWNER_KIND_BY_RUN_KIND[runKind(run.package)],
        id: run.id,
        name: run.name,
        href: runHref(run.id, run.package),
      },
      location: run.location,
      clients: dedupeClients(
        enrolments.map(e => ({
          id: e.clientId,
          name: e.client?.user?.name ?? 'Unnamed client',
          dog: e.dog?.name ?? null,
        })),
      ),
    }
  }

  if (target === 'package') {
    // 1:1 packages only. A GROUP package's flow hangs off its run, not off the
    // package — the same condition the offering page mounts the editor on.
    const pkg = await prisma.package.findFirst({
      where: { id, trainerId, isGroup: false },
      select: { id: true, name: true },
    })
    if (!pkg) return null
    const assignments = await prisma.clientPackage.findMany({
      where: { packageId: pkg.id },
      select: {
        clientId: true,
        client: {
          select: {
            user: { select: { name: true } },
            dog: { select: { name: true } },
            dogs: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 },
          },
        },
      },
    })
    return {
      owner: { kind: 'PACKAGE', id: pkg.id, name: pkg.name, href: `/packages/${pkg.id}` },
      location: null,
      clients: dedupeClients(
        assignments.map(a => ({
          id: a.clientId,
          name: a.client?.user?.name ?? 'Unnamed client',
          dog: a.client?.dog?.name ?? a.client?.dogs[0]?.name ?? null,
        })),
      ),
    }
  }

  if (target === 'membership') {
    const membership = await prisma.membership.findFirst({
      where: { id, trainerId },
      select: { id: true, name: true },
    })
    if (!membership) return null
    // Memberships have no per-id route — their editor opens inside the list.
    return {
      owner: { kind: 'MEMBERSHIP', id: membership.id, name: membership.name, href: '/memberships' },
      location: null,
      // A membership flow has no cohort to pick from: its steps reach whoever
      // holds an active purchase, and the offering page passes none either.
      clients: [],
    }
  }

  const form = await prisma.form.findFirst({ where: { id, trainerId }, select: { id: true, name: true } })
  if (!form) return null
  return {
    owner: { kind: 'FORM', id: form.id, name: form.name, href: `/forms/client/${form.id}` },
    location: null,
    // A journey has one person in it — there is nobody to choose.
    clients: [],
  }
}

/** One row per client. A client with two dogs on the same class is one person
 *  in the picker, exactly as the offering pages already show them. */
function dedupeClients(list: ClientOpt[]): ClientOpt[] {
  return Array.from(new Map(list.map(c => [c.id, c])).values())
}
