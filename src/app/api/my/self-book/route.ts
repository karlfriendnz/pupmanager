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
import { isTimeWithinAvailability, overlapsBusy } from '@/lib/availability'
import { utcToZonedDateAndMinutes } from '@/lib/timezone'
import { env } from '@/lib/env'

// GET  /api/my/self-book  — packages this client may self-book
// POST /api/my/self-book  — book one (instant or pending request)
async function clientCtx() {
  const active = await getActiveClient()
  if (!active) return null
  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { id: true, trainerId: true, dogId: true },
  })
  if (!profile) return null
  return { ...active, trainerId: profile.trainerId, dogId: profile.dogId }
}

export async function GET() {
  const ctx = await clientCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const packages = await prisma.package.findMany({
    where: { trainerId: ctx.trainerId, clientSelfBook: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, name: true, description: true, sessionCount: true,
      weeksBetween: true, durationMins: true, bufferMins: true, sessionType: true,
      priceCents: true, selfBookRequiresApproval: true,
    },
  })
  return NextResponse.json(packages)
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

  const pkg = await prisma.package.findFirst({
    where: { id: parsed.data.packageId, trainerId: ctx.trainerId, clientSelfBook: true },
  })
  if (!pkg) return NextResponse.json({ error: 'Package not available' }, { status: 404 })

  const start = new Date(parsed.data.startDate)
  if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) {
    return NextResponse.json({ error: 'Pick a start time in the future' }, { status: 400 })
  }

  // Defense-in-depth: never trust the client's chosen time. Reject any start
  // that doesn't sit fully inside one of the trainer's published availability
  // windows (in the trainer's timezone) and outside their blackouts.
  const avail = await getTrainerAvailabilityForClient(ctx.clientId)
  if (!avail) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { dateStr, minuteOfDay } = utcToZonedDateAndMinutes(start, avail.tz)
  if (!isTimeWithinAvailability(avail.slots, dateStr, minuteOfDay, pkg.durationMins, avail.blackouts)) {
    return NextResponse.json({ error: "That time isn't available" }, { status: 400 })
  }
  // The trainer runs one session at a time — reject a start that collides with
  // an existing booking (someone may have grabbed it since the picker loaded).
  // Buffers count on both sides: this package's own turnaround gap, and the gap
  // hanging off each existing booking.
  if (overlapsBusy(avail.busy, dateStr, minuteOfDay, pkg.durationMins, pkg.bufferMins)) {
    return NextResponse.json({ error: "That time's just been taken" }, { status: 400 })
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
      const avail = `${env.NEXT_PUBLIC_APP_URL}/my-availability`
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
        successUrl: `${avail}?purchase=success`,
        cancelUrl: `${avail}?purchase=cancelled`,
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
  // Best-effort receivable for the self-booked package (this free-flow path only;
  // the paid path above goes through Stripe checkout instead).
  await createInvoiceForAssignment({ trainerId: ctx.trainerId, clientId: ctx.clientId, sourceType: 'PACKAGE', clientPackageId: assignmentId })
  return NextResponse.json({ ok: true, mode: 'booked' }, { status: 201 })
}
