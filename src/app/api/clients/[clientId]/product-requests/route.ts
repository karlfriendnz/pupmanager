import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { createInvoiceForAssignment } from '@/lib/invoicing'
import { z } from 'zod'

const postSchema = z.object({
  productId: z.string().min(1),
  note: z.string().max(500).optional(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { clientId } = await params

  const access = await getClientAccess(clientId, session.user.id)
  if (!access || !access.canEdit) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  // Make sure the product belongs to this trainer (the calling trainer's own
  // shop). Co-managers can pull from the primary trainer's catalogue, since
  // the client's "store" is that primary.
  const product = await prisma.product.findFirst({
    where: { id: parsed.data.productId, trainerId: access.client.trainerId },
    select: { id: true },
  })
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  // No `active` gate here: a trainer can add any of their own products to a
  // client, including hidden ones. `active` only controls the client's shop.

  // Idempotent — return any existing PENDING request for this pair.
  const existing = await prisma.productRequest.findFirst({
    where: { clientId, productId: parsed.data.productId, status: 'PENDING' },
  })
  if (existing) return NextResponse.json(existing)

  const created = await prisma.productRequest.create({
    data: {
      clientId,
      productId: parsed.data.productId,
      note: parsed.data.note ?? null,
      status: 'PENDING',
    },
  })

  // Best-effort receivable for the assigned product (idempotent, skips unpriced).
  await createInvoiceForAssignment({
    trainerId: access.client.trainerId,
    clientId,
    sourceType: 'PRODUCT',
    productId: parsed.data.productId,
  })

  return NextResponse.json(created, { status: 201 })
}
