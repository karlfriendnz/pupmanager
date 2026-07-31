import { NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { runKind, runKindLabel, runHref, type RunKind } from '@/lib/run-kind'

export const runtime = 'nodejs'

/**
 * Turn one kind of group offering into another — class, casual class, event.
 *
 * All three are the same two rows (ClassRun + Package) wearing different
 * declared flags, so converting is mostly flipping those and tidying the parts
 * that only make sense for the kind being left behind. What it must never do is
 * INFER a kind: run-kind.ts records what that cost last time — "event" used to
 * be a shape, an ordinary one-off class matched it, and a customer lost 55 of
 * her 63 classes off the screen she made them on. Every flag here is set
 * explicitly, both ways.
 *
 * Daycare is not a target. Its day-parts and drop-in booking model are a
 * different shape again, and nobody has asked to convert into it.
 *
 * WHAT IT REFUSES, AND WHY
 *
 * Anyone enrolled — as before. A roster should be cancelled properly, which
 * notifies people, rather than dissolved underneath them.
 *
 * Anyone INVOICED, even if they have since withdrawn. This is new. Money having
 * moved is a stronger reason to stop than a name on a roster, and it was not
 * checked at all: a client could be invoiced, withdraw, and the offering they
 * were billed for could then quietly become something else.
 *
 * Converting a multi-session class to an EVENT. An event is one occasion — its
 * run page IS its session, there is no per-session screen — so six sessions
 * cannot become one event without destroying five, and cannot become six events
 * without turning one £720 series into £4,320. The trainer is told to shorten it
 * or duplicate it, and keeps hold of the money decision.
 *
 * WHAT IT CARRIES, LOUDLY
 *
 * The price, unchanged. Its UNIT changes — a series price becomes a per-event or
 * per-drop-in price — and no arithmetic we could do would be right for a trainer
 * who discounted a block. The caller shows the warning this returns.
 */

const schema = z.object({ to: z.enum(['class', 'casual', 'event']) })

type Target = 'class' | 'casual' | 'event'

const LABEL: Record<Target, string> = {
  class: 'group class',
  casual: 'casual class',
  event: 'event',
}

export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const guard = await guardPermission('packages.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  const trainerId = session?.user?.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid target' }, { status: 400 })
  const to: Target = parsed.data.to

  const { runId } = await params
  const run = await prisma.classRun.findFirst({
    where: { id: runId, trainerId },
    select: {
      id: true,
      packageId: true,
      startDate: true,
      package: {
        select: {
          id: true, name: true, isEvent: true, allowDropIn: true, isPuppySchool: true,
          priceCents: true, sessionCount: true, durationMins: true,
        },
      },
      sessions: { select: { id: true, scheduledAt: true, durationMins: true }, orderBy: { sessionIndex: 'asc' } },
      // Every enrolment, not just live ones: a WITHDRAWN client who was already
      // invoiced is exactly the case the money guard exists for.
      enrollments: { select: { id: true, status: true, invoicedAt: true } },
    },
  })
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const from: RunKind = runKind(run.package)
  if (from === 'daycare') {
    return NextResponse.json(
      { error: 'Daycare works differently and can’t be converted here.' },
      { status: 409 },
    )
  }
  if (from === to) {
    return NextResponse.json(
      { error: `This is already a ${LABEL[to]}.` },
      { status: 409 },
    )
  }

  const live = run.enrollments.filter(e => e.status !== 'WITHDRAWN')
  if (live.length > 0) {
    const n = live.length
    return NextResponse.json(
      { error: `${n} ${n === 1 ? 'person is' : 'people are'} booked in. Remove them (or cancel it) before converting.` },
      { status: 409 },
    )
  }

  const invoiced = run.enrollments.filter(e => e.invoicedAt)
  if (invoiced.length > 0) {
    const n = invoiced.length
    return NextResponse.json(
      {
        error:
          `${n} ${n === 1 ? 'booking has' : 'bookings have'} already been invoiced for this ${runKindLabel(run.package).toLowerCase()}. ` +
          `Converting it would change what those people were billed for — sort the invoices out first.`,
      },
      { status: 409 },
    )
  }

  // An event is a single occasion, by definition.
  if (to === 'event' && run.sessions.length > 1) {
    return NextResponse.json(
      {
        error:
          `An event is a single occasion, and this has ${run.sessions.length} sessions. ` +
          `Shorten it to one session first, or duplicate it as separate events — ` +
          `splitting it here would turn one price into ${run.sessions.length}.`,
      },
      { status: 409 },
    )
  }

  // Everything a kind leaves behind. Stated per target rather than derived, so
  // adding a fourth kind means writing its row rather than hoping.
  const flags = {
    class: { isEvent: false, allowDropIn: false, isGroup: true },
    casual: { isEvent: false, allowDropIn: true, isGroup: true },
    event: { isEvent: true, allowDropIn: false, isGroup: true },
  }[to]

  // A casual class is scheduled by SLOT, not by a fixed series. Derive one from
  // when this actually runs, so the offering is not left with no schedule at
  // all — the trainer can edit it afterwards.
  const first = run.sessions[0]
  const anchor = first?.scheduledAt ?? run.startDate
  const mins = first?.durationMins ?? run.package.durationMins ?? 60
  const pad = (n: number) => String(n).padStart(2, '0')
  const slot = anchor
    ? {
        day: anchor.getDay(),
        startTime: `${pad(anchor.getHours())}:${pad(anchor.getMinutes())}`,
        endTime: `${pad(new Date(anchor.getTime() + mins * 60_000).getHours())}:${pad(new Date(anchor.getTime() + mins * 60_000).getMinutes())}`,
      }
    : null

  try {
    await prisma.$transaction(async tx => {
      await tx.package.update({
        where: { id: run.packageId },
        data: {
          ...flags,
          // Only a casual class sells single sessions.
          ...(to === 'casual' ? {} : { dropInPriceCents: null }),
        },
      })

      // Ticket tiers belong to events. Leaving one strands them on an offering
      // with no screen to edit them from.
      if (from === 'event') {
        await tx.packageTicketTier.deleteMany({ where: { packageId: run.packageId } })
      }

      // Slots belong to casual (and daycare). Leaving casual, they would keep
      // generating sessions for a series that no longer works that way.
      if (from === 'casual') {
        await tx.packageSessionSlot.deleteMany({ where: { packageId: run.packageId } })
      }

      if (to === 'casual' && slot) {
        const existing = await tx.packageSessionSlot.count({ where: { packageId: run.packageId } })
        if (existing === 0) {
          await tx.packageSessionSlot.create({
            data: { packageId: run.packageId, order: 0, ...slot },
          })
        }
      }
    })
  } catch (err) {
    console.error('[class-runs] convert failed', { runId, from, to, err })
    return NextResponse.json({ error: 'Could not convert this. Please try again.' }, { status: 500 })
  }

  const pkg = { ...run.package, ...flags }
  const priceWarning =
    run.package.priceCents && run.package.priceCents > 0 && run.sessions.length > 1 && to === 'casual'
      ? `The price is still set for the whole series. As a casual class that is charged per drop-in — check it before anyone books.`
      : null

  return NextResponse.json({
    ok: true,
    from,
    to,
    href: runHref(run.id, pkg),
    priceWarning,
  })
}
