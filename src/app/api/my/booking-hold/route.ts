import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { enforceRateLimit } from '@/lib/rate-limit'
import { getTrainerAvailabilityForClient } from '@/lib/client-availability'
import { packageBookingWindow, checkBookableStart } from '@/lib/package-booking-window'
import { utcToZonedDateAndMinutes } from '@/lib/timezone'
import { offeringVisibleWhere } from '@/lib/offering-visibility'
import { bookingGateFor } from '@/lib/booking-gate'
import { createBookingHold } from '@/lib/booking-holds'

// POST /api/my/booking-hold — claim a 1:1 slot while the client answers the
// offering's gating form.
//
// Called when they leave "Pick a time" for the form step. Without it the hour
// they chose can be taken by somebody else while they type, and they would find
// out at the end — after answering five questions they were told to answer.
//
// The hold is NOT a booking. It creates no TrainingSession, no ClientPackage and
// no invoice; nothing that draws the trainer's calendar, counts bookings or
// reports on them reads the table it lands in. All it does is make the slot
// count as busy for OTHER people, for a few minutes, with the expiry applied on
// every read (lib/booking-holds).
const schema = z.object({
  packageId: z.string().min(1),
  // The chosen first-session start, ISO — the same field self-book takes, and
  // validated by the same resolver, so a hold can never be placed on a slot the
  // booking would then refuse.
  startDate: z.string().min(1),
})

export async function POST(req: Request) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // A trainer previewing the client app must not take slots out of their own
  // diary, exactly as they must not create real bookings.
  if (active.isPreview) return NextResponse.json({ error: 'Preview mode — booking disabled' }, { status: 403 })

  // A hold costs somebody else a slot, so it is rate-limited like a booking is.
  const limited = await enforceRateLimit({ key: `bookhold:${active.clientId}`, limit: 30, windowMs: 10 * 60_000 })
  if (limited) return limited

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { id: true, trainerId: true },
  })
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const pkg = await prisma.package.findFirst({
    where: {
      id: parsed.data.packageId,
      trainerId: profile.trainerId,
      clientSelfBook: true,
      isGroup: false,
      ...offeringVisibleWhere(),
    },
    select: { id: true, durationMins: true, bufferMins: true, bookingWindowMode: true, bookingWindowDays: true, bookingWindowStart: true, bookingWindowEnd: true, bookingWindowTimes: true },
  })
  if (!pkg) return NextResponse.json({ error: 'This 1:1 session is not available' }, { status: 404 })

  const start = new Date(parsed.data.startDate)
  if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) {
    return NextResponse.json({ error: 'Pick a start time in the future' }, { status: 400 })
  }

  // The same three gates the booking itself applies — availability, collisions
  // (other people's sessions AND other people's live holds, via
  // getTrainerAvailabilityForClient), and this offering's booking window.
  // Holding a slot the booking would refuse would only move the disappointment
  // from the start of the form to the end of it.
  const avail = await getTrainerAvailabilityForClient(profile.id)
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
    return NextResponse.json(
      {
        error: check.reason === 'taken' ? "That time's just been taken"
          : check.reason === 'outside-window' ? "This one isn't offered at that time"
          : "That time isn't available",
        code: 'SLOT_TAKEN',
      },
      { status: 409 },
    )
  }

  const gate = await bookingGateFor({ packageId: pkg.id })

  const held = await createBookingHold({
    trainerId: profile.trainerId,
    clientId: profile.id,
    packageId: pkg.id,
    slotAt: start,
    durationMins: pkg.durationMins,
    bufferMins: pkg.bufferMins,
    formId: gate?.formId ?? null,
    stepId: gate?.stepId ?? null,
  })
  if (!held.ok) {
    return NextResponse.json({ error: "That time's just been taken", code: 'SLOT_TAKEN' }, { status: 409 })
  }

  return NextResponse.json(
    { holdId: held.hold.id, expiresAt: held.hold.expiresAt.toISOString(), gated: !!gate },
    { status: 201 },
  )
}
