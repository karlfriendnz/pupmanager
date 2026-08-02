import { NextResponse } from 'next/server'
import { takeStock } from '@/lib/stock'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { createInvoiceForAssignment } from '@/lib/invoicing'
import { z } from 'zod'

const postSchema = z.object({
  productId: z.string().min(1),
  // Which size/colour the trainer handed over. Checked against the product's
  // own variants below.
  variantId: z.string().nullable().optional(),
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
    select: { id: true, variants: { select: { id: true } } },
  })
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  // No `active` gate here: a trainer can add any of their own products to a
  // client, including hidden ones. `active` only controls the client's shop.
  // Hidden VARIANTS are allowed for the same reason — a trainer handing over
  // the last of a discontinued size is recording what happened.

  const variants = product.variants ?? []
  const variantId = parsed.data.variantId ?? null
  if (variantId && !variants.some(v => v.id === variantId)) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }
  if (variants.length > 0 && !variantId) {
    return NextResponse.json({ error: 'Choose an option first.' }, { status: 400 })
  }

  // Idempotent — return any existing PENDING request for this exact thing.
  // Per VARIANT: giving a client a Large when a Small is already pending is a
  // second item, not a repeat.
  const existing = await prisma.productRequest.findFirst({
    where: { clientId, productId: parsed.data.productId, variantId, status: 'PENDING' },
  })
  if (existing) return NextResponse.json(existing)

  // One unit off the shelf; a tracked product that's run out is refused so the
  // trainer finds out here rather than when they go to hand it over. The
  // ledger line names both the client it went to and the trainer who did it,
  // which is the pair you need when a count looks wrong a fortnight later.
  if (!(await takeStock(prisma, parsed.data.productId, {
    clientId,
    userId: session.user.id,
    variantId,
    note: 'Added to a client by their trainer',
  }))) {
    return NextResponse.json({ error: 'That item is out of stock.' }, { status: 409 })
  }

  const created = await prisma.productRequest.create({
    data: {
      clientId,
      productId: parsed.data.productId,
      variantId,
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
    productVariantId: variantId,
  })

  return NextResponse.json(created, { status: 201 })
}
