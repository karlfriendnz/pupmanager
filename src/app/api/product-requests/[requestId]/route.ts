import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { safeEvaluate } from '@/lib/achievements'
import { z } from 'zod'

const patchSchema = z.object({
  status: z.enum(['FULFILLED', 'CANCELLED']),
  // Optional — when fulfilling at a specific session. The trainer's most
  // recent past session for that client is a sensible auto-pick if omitted.
  fulfilledSessionId: z.string().optional().nullable(),
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

  return NextResponse.json(updated)
}
