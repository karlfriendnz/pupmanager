import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { safeEvaluate } from '@/lib/achievements'
import { generateSessionDates, createBookingAssignment } from '@/lib/self-book'
import { createInvoiceForAssignment } from '@/lib/invoicing'
import { resolveRequirePayment } from '@/lib/require-payment'
import { createConnectCheckout } from '@/lib/connect-checkout'
import { isConnectConfigured } from '@/lib/connect'
import { enforceRateLimit } from '@/lib/rate-limit'
import { getTrainerAvailabilityForClient } from '@/lib/client-availability'
import { packageBookingWindow, checkBookableStart } from '@/lib/package-booking-window'
import { utcToZonedDateAndMinutes } from '@/lib/timezone'
import { notifyTrainer } from '@/lib/trainer-notify'
import { env } from '@/lib/env'
import { offeringVisibleWhere } from '@/lib/offering-visibility'

// GET  /api/my/self-book  — packages this client may self-book
// POST /api/my/self-book  — book one (instant or pending request)
async function clientCtx() {
  const active = await getActiveClient()
  if (!active) return null
  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: {
      id: true, trainerId: true, dogId: true,
      // Trainer routing + names for the "client booked" notification (assigned
      // member first, else the business owner — same shape as the logs route).
      user: { select: { name: true } },
      dog: { select: { name: true } },
      trainer: { select: { user: { select: { id: true } } } },
      assignedTrainer: { select: { user: { select: { id: true } } } },
    },
  })
  if (!profile) return null
  return {
    ...active,
    trainerId: profile.trainerId,
    dogId: profile.dogId,
    clientName: profile.user?.name ?? 'A client',
    dogName: profile.dog?.name ?? '',
    trainerUserId: profile.assignedTrainer?.user?.id ?? profile.trainer?.user?.id ?? null,
  }
}

// Short human date for a notification detail, e.g. "Thu 17 Jul". Rendered in the
// trainer's timezone (the session happens in their locale) so it never shifts a
// day under the server's UTC clock.
function shortDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(d)
}

export async function GET() {
  const ctx = await clientCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // 1:1 only. A group offering runs on its own timetable — it's joined from
  // the classes list, by picking real sessions, not by choosing an hour out of
  // the trainer's diary.
  const packages = await prisma.package.findMany({
    // ...and not scheduled to appear later — see lib/offering-visibility.
    where: { trainerId: ctx.trainerId, clientSelfBook: true, isGroup: false, ...offeringVisibleWhere() },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, name: true, description: true, sessionCount: true,
      weeksBetween: true, durationMins: true, bufferMins: true, sessionType: true,
      priceCents: true, selfBookRequiresApproval: true,
      // WHEN this one may be booked. Sent so any picker built off this list
      // narrows to the same times the POST above will accept.
      bookingWindowMode: true, bookingWindowDays: true, bookingWindowStart: true,
      bookingWindowEnd: true, bookingWindowTimes: true,
    },
  })
  return NextResponse.json(
    packages.map(p => ({ ...p, bookingWindow: packageBookingWindow(p) })),
  )
}

const schema = z.object({
  packageId: z.string().min(1),
  // Client-chosen first-session datetime (ISO). Subsequent sessions are
  // placed on the package cadence from here.
  startDate: z.string().min(1),
})

export async function POST(req: Request) {
  const ctx = await clientCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // A trainer previewing the client app must not create real bookings.
  if (ctx.isPreview) {
    return NextResponse.json({ error: 'Preview mode — booking disabled' }, { status: 403 })
  }

  // Bounds the paid path (each creates a PENDING Payment + Stripe session).
  const limited = await enforceRateLimit({ key: `selfbook:${ctx.clientId}`, limit: 12, windowMs: 10 * 60_000 })
  if (limited) return limited

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // isGroup: false here too, not just on the list. Booking a class down this
  // path would cut private 1:1 sessions off a shared timetable — the client
  // would hold sessions nobody else in the class has, at an hour the class
  // doesn't run, and never appear on its roster.
  const pkg = await prisma.package.findFirst({
    // The visibility gate belongs on the WRITE side too, not just the list:
    // an id is guessable, and a client who books a not-yet-showing offering
    // has booked something the trainer had not opened yet.
    where: { id: parsed.data.packageId, trainerId: ctx.trainerId, clientSelfBook: true, isGroup: false, ...offeringVisibleWhere() },
  })
  if (!pkg) return NextResponse.json({ error: 'This 1:1 session is not available' }, { status: 404 })

  const start = new Date(parsed.data.startDate)
  if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) {
    return NextResponse.json({ error: 'Pick a start time in the future' }, { status: 400 })
  }

  // Defense-in-depth: never trust the client's chosen time. THIS is where the
  // rule lives, not in the picker — the screen won't offer a bad time, but a
  // crafted POST doesn't come from the screen. Three gates, applied by the one
  // resolver the picker itself filters with (lib/package-booking-window):
  //
  //   1. the start sits fully inside the trainer's published availability, in
  //      the trainer's timezone, and outside their blackouts;
  //   2. it doesn't collide with an existing booking — the trainer runs one
  //      session at a time, and someone may have taken it since the picker
  //      loaded. Buffers count on both sides: this package's own turnaround
  //      gap, and the gap hanging off each existing booking;
  //   3. it's inside THIS offering's booking window, when it has one. That gate
  //      only ever removes times 1 and 2 already allowed — a window can never
  //      conjure an hour the trainer isn't free for.
  const avail = await getTrainerAvailabilityForClient(ctx.clientId)
  if (!avail) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { dateStr, minuteOfDay } = utcToZonedDateAndMinutes(start, avail.tz)
  const check = checkBookableStart({
    slots: avail.slots,
    blackouts: avail.blackouts,
    busy: avail.busy,
    dateStr,
    startMin: minuteOfDay,
    durationMins: pkg.durationMins,
    bufferMins: pkg.bufferMins,
    window: packageBookingWindow(pkg),
  })
  if (!check.ok) {
    const message =
      check.reason === 'taken' ? "That time's just been taken"
      : check.reason === 'outside-window' ? "This one isn't offered at that time"
      : "That time isn't available"
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const dates = generateSessionDates(start, pkg.sessionCount, pkg.weeksBetween)

  // Approval-required packages are REQUEST-FIRST: never charge up front. A
  // booking request is created; the invoice/payment only happens when the trainer
  // APPROVES it (booking-requests/[id] → createInvoiceForAssignment). This must
  // come before the paid path so an approval-required package is never a
  // pay-to-book.
  if (pkg.selfBookRequiresApproval) {
    await prisma.bookingRequest.create({
      data: {
        trainerId: ctx.trainerId,
        clientId: ctx.clientId,
        packageId: pkg.id,
        dogId: ctx.dogId,
        sessionDates: dates.map(d => d.toISOString()),
      },
    })
    if (ctx.trainerUserId) {
      await notifyTrainer(
        ctx.trainerUserId,
        'CLIENT_BOOKED_SESSION',
        { clientName: ctx.clientName, dogName: ctx.dogName, detail: `${pkg.name} on ${shortDate(start, avail.tz)}` },
        '/schedule',
        ctx.trainerId,
      )
    }
    return NextResponse.json({ ok: true, mode: 'requested' }, { status: 201 })
  }

  // Paid packages (instant, no approval needed): pay-to-confirm — we don't create
  // calendar rows now; the connect webhook does that once the payment succeeds.
  const price = pkg.specialPriceCents ?? pkg.priceCents
  if (price && price > 0) {
    const trainer = await prisma.trainerProfile.findUnique({
      where: { id: ctx.trainerId },
      select: {
        acceptPaymentsEnabled: true,
        connectChargesEnabled: true,
        connectAccountId: true,
        payoutCurrency: true,
        sandboxBilling: true,
        defaultRequirePayment: true,
      },
    })
    // Only take the pay-to-book branch when the trainer can take cards AND this
    // package resolves to require-payment. Otherwise fall through to instant-book
    // + a receivable (book now, pay later).
    if (
      trainer?.acceptPaymentsEnabled && trainer.connectChargesEnabled && trainer.connectAccountId &&
      resolveRequirePayment(pkg.requirePayment, trainer.defaultRequirePayment)
    ) {
      const sandbox = trainer.sandboxBilling
      if (!isConnectConfigured(sandbox)) {
        return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
      }
      const appUrl = env.NEXT_PUBLIC_APP_URL
      const { url } = await createConnectCheckout({
        sandbox,
        trainerId: ctx.trainerId,
        connectAccountId: trainer.connectAccountId,
        clientId: ctx.clientId,
        currency: trainer.payoutCurrency ?? 'nzd',
        description: pkg.name,
        lines: [
          {
            kind: 'PACKAGE',
            description: pkg.name,
            unitAmount: price,
            quantity: 1,
            intent: {
              packageId: pkg.id,
              slotIso: start.toISOString(),
              dogId: ctx.dogId,
              singleDurationMins: pkg.durationMins,
              singleSessionType: pkg.sessionType,
              singleTitle: pkg.name,
            },
          },
        ],
        // On success land on the client's Sessions timeline, where the newly
        // paid-for session shows once the connect webhook books it. A cancelled
        // payment returns to the availability wizard so they can retry.
        successUrl: `${appUrl}/my-sessions?booked=1`,
        cancelUrl: `${appUrl}/my-availability?purchase=cancelled`,
      })
      if (!url) return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
      return NextResponse.json({ ok: true, mode: 'payment', url }, { status: 201 })
    }
    // Trainer hasn't enabled payments — fall through to the normal flow.
  }

  // Instant book (free package, or payments off / not-required — book now, pay later).
  const assignmentId = await prisma.$transaction(tx =>
    createBookingAssignment(tx, {
      trainerId: ctx.trainerId,
      clientId: ctx.clientId,
      packageId: pkg.id,
      dogId: ctx.dogId,
      pkg,
      sessionDates: dates,
    }),
  )
  await safeEvaluate(ctx.clientId)
  // Best-effort: mirror the newly-booked session(s) onto the trainer's Google
  // Calendar. createBookingAssignment uses createMany (no ids), so re-read the
  // rows by the assignment we just created. Wrapped so it never breaks booking.
  try {
    const createdRows = await prisma.trainingSession.findMany({
      where: { clientPackageId: assignmentId },
      select: { id: true },
    })
    if (createdRows.length) {
      const { syncSessionsToGoogle } = await import('@/lib/google-calendar-sync')
      await syncSessionsToGoogle(createdRows.map(r => r.id))
    }
  } catch {
    // Non-critical
  }
  // Best-effort receivable for the self-booked package (this free-flow path only;
  // the paid path above goes through Stripe checkout instead).
  await createInvoiceForAssignment({ trainerId: ctx.trainerId, clientId: ctx.clientId, sourceType: 'PACKAGE', clientPackageId: assignmentId })
  if (ctx.trainerUserId) {
    await notifyTrainer(
      ctx.trainerUserId,
      'CLIENT_BOOKED_SESSION',
      { clientName: ctx.clientName, dogName: ctx.dogName, detail: `${pkg.name} on ${shortDate(start, avail.tz)}` },
      '/schedule',
      ctx.trainerId,
    )
  }
  return NextResponse.json({ ok: true, mode: 'booked' }, { status: 201 })
}
