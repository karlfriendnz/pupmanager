import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { safeEvaluate } from '@/lib/achievements'
import { releaseCancelledRequest, setProductOrderQuantity } from '@/lib/product-requests'
import { quantitySchema } from '@/lib/product-quantity'
import { z } from 'zod'

const patchSchema = z.object({
  status: z.enum(['FULFILLED', 'CANCELLED']),
  // Optional — when fulfilling at a specific session. The trainer's most
  // recent past session for that client is a sensible auto-pick if omitted.
  fulfilledSessionId: z.string().optional().nullable(),
})

/**
 * The other thing a PATCH can say: how many.
 *
 * A separate schema rather than another optional field on the one above,
 * because they are two different actions on the same row and folding them
 * together would let a body say "cancel this AND make it three" — a request
 * with no sensible meaning that the route would have had to pick a winner for.
 */
const quantityPatchSchema = z.object({
  quantity: quantitySchema.unwrap(),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { requestId } = await params

  // Verify the request belongs to one of this trainer's clients
  const request = await prisma.productRequest.findUnique({
    where: { id: requestId },
    include: { client: { select: { trainerId: true } } },
  })
  if (!request || request.client.trainerId !== trainerId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()

  // "Make it three" — the stepper on the add screen. Handled before the status
  // branch because it is a different action on the same row: it re-sizes the
  // order, running the same three effects for the DIFFERENCE (units on or off
  // the shelf, the row, the receivable) rather than ending it.
  const asQuantity = quantityPatchSchema.safeParse(body)
  if (asQuantity.success) {
    const result = await setProductOrderQuantity({
      trainerId,
      clientId: request.clientId,
      requestId,
      quantity: asQuantity.data.quantity,
      userId: session.user.id,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.request)
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const updated = await prisma.productRequest.update({
    where: { id: requestId },
    data: {
      status: parsed.data.status,
      fulfilledSessionId: parsed.data.status === 'FULFILLED'
        ? (parsed.data.fulfilledSessionId ?? null)
        : null,
      fulfilledAt: parsed.data.status === 'FULFILLED' ? new Date() : null,
    },
  })

  if (parsed.data.status === 'FULFILLED') {
    await safeEvaluate(updated.clientId)
  }

  // Dismissing an order is the trainer's half of the client's cancel, and it has
  // the same two things to undo: the units off the shelf and the receivable.
  // Only on the way INTO cancelled — re-sending the same PATCH must not keep
  // handing back stock for one order (audit C-3).
  //
  // It undoes AS MANY as the order took. `updated.quantity` is the count the
  // order was placed with, and returning a hard-coded 1 against an order for
  // three would leave the shelf two short with no movement explaining it — the
  // same shape of bug as C-3, just arithmetic instead of omission.
  if (parsed.data.status === 'CANCELLED' && request.status === 'PENDING') {
    await releaseCancelledRequest({
      trainerId,
      clientId: updated.clientId,
      productId: updated.productId,
      variantId: updated.variantId,
      quantity: updated.quantity,
    })
  }

  return NextResponse.json(updated)
}
