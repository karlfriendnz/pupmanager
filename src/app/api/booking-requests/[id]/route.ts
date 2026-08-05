import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { confirmBookingRequest } from '@/lib/booking-request-confirm'

// PATCH /api/booking-requests/[id] — trainer confirms or declines a
// pending client self-booking. CONFIRM spawns the ClientPackage +
// sessions from the proposed dates (same as a manual assignment).
//
// Suggesting a DIFFERENT time is a third path and lives next door, in
// ./propose — it doesn't decide the request, it volleys it.
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

  if (parsed.data.action === 'DECLINE') {
    const reqRow = await prisma.bookingRequest.findFirst({
      where: { id, trainerId, status: 'PENDING' },
      include: { package: { select: { name: true } } },
    })
    if (!reqRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.bookingRequest.update({
      where: { id },
      data: { status: 'DECLINED', decidedAt: new Date() },
    })
    // Deciding the request ends the negotiation with it. Leaving an OPEN
    // proposal behind would leave a live Approve button on a request that no
    // longer exists to book — the same "superseded card" bug by another route.
    await closeOpenProposals(id)
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

  // CONFIRM — turn the proposed dates into a real assignment. Shared with the
  // "client approved the trainer's counter-offer" path so the two produce
  // identical records.
  const result = await confirmBookingRequest({ requestId: id, trainerId })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  await closeOpenProposals(id)

  return NextResponse.json({ ok: true, status: 'CONFIRMED', clientPackageId: result.clientPackageId })
}

/** Any counter-offer still awaiting an answer is withdrawn once the request
 *  itself has been decided some other way. */
async function closeOpenProposals(requestId: string): Promise<void> {
  await prisma.bookingProposal
    .updateMany({
      where: { requestId, status: 'OPEN' },
      data: { status: 'WITHDRAWN', decidedAt: new Date() },
    })
    .catch(e => console.error('[booking decide] close proposals failed', e))
}
