import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { safeEvaluate } from '@/lib/achievements'
import { createBookingAssignment } from '@/lib/self-book'

// PATCH /api/booking-requests/[id] — trainer confirms or declines a
// pending client self-booking. CONFIRM spawns the ClientPackage +
// sessions from the proposed dates (same as a manual assignment).
const schema = z.object({ action: z.enum(['CONFIRM', 'DECLINE']) })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const reqRow = await prisma.bookingRequest.findFirst({
    where: { id, trainerId, status: 'PENDING' },
    include: {
      package: { select: { name: true, sessionCount: true, durationMins: true, sessionType: true } },
    },
  })
  if (!reqRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (parsed.data.action === 'DECLINE') {
    await prisma.bookingRequest.update({
      where: { id },
      data: { status: 'DECLINED', decidedAt: new Date() },
    })
    await prisma.clientNotification
      .create({
        data: {
          clientId: reqRow.clientId,
          trainerId,
          subject: `Booking request declined`,
          notes: `Your request to book ${reqRow.package.name} couldn't be confirmed. Please get in touch to find a time.`,
        },
      })
      .catch(e => console.error('[booking decline] notify failed', e))
    return NextResponse.json({ ok: true, status: 'DECLINED' })
  }

  // CONFIRM — turn the proposed dates into a real assignment.
  const dates = (Array.isArray(reqRow.sessionDates) ? reqRow.sessionDates : [])
    .map(d => new Date(String(d)))
    .filter(d => !Number.isNaN(d.getTime()))
  if (dates.length === 0) {
    return NextResponse.json({ error: 'Request has no valid session dates' }, { status: 400 })
  }

  const assignmentId = await prisma.$transaction(async tx => {
    const aid = await createBookingAssignment(tx, {
      trainerId,
      clientId: reqRow.clientId,
      packageId: reqRow.packageId,
      dogId: reqRow.dogId,
      pkg: reqRow.package,
      sessionDates: dates,
    })
    await tx.bookingRequest.update({
      where: { id },
      data: { status: 'CONFIRMED', decidedAt: new Date(), resultingClientPackageId: aid },
    })
    return aid
  })

  await safeEvaluate(reqRow.clientId)
  await prisma.clientNotification
    .create({
      data: {
        clientId: reqRow.clientId,
        trainerId,
        subject: `Booking confirmed: ${reqRow.package.name}`,
        notes: `Your ${reqRow.package.name} sessions are now on the calendar.`,
      },
    })
    .catch(e => console.error('[booking confirm] notify failed', e))

  return NextResponse.json({ ok: true, status: 'CONFIRMED', clientPackageId: assignmentId })
}
