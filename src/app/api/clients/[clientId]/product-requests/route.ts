import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { placeProductOrder } from '@/lib/product-requests'
import { quantitySchema } from '@/lib/product-quantity'
import { z } from 'zod'

const postSchema = z.object({
  productId: z.string().min(1),
  // Which size/colour the trainer handed over. Checked against the product's
  // own variants below.
  variantId: z.string().nullable().optional(),
  // How many. Optional so an app build that predates the control still means
  // one, and bounds-checked HERE rather than trusted from the stepper —
  // whatever the form refuses, the route must refuse (AGENTS.md #3).
  quantity: quantitySchema,
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
    // name + the counts come back so a short shelf can be refused with a
    // message that says WHICH thing and HOW MANY are left, rather than a bare
    // "out of stock" against a product sitting right there.
    select: {
      id: true, name: true, stockCount: true,
      variants: { select: { id: true, name: true, stockCount: true } },
    },
  })
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  // No `active` gate here: a trainer can add any of their own products to a
  // client, including hidden ones. `active` only controls the client's shop.
  // Hidden VARIANTS are allowed for the same reason — a trainer handing over
  // the last of a discontinued size is recording what happened.

  const variants = product.variants ?? []
  const variantId = parsed.data.variantId ?? null
  const variant = variantId ? variants.find(v => v.id === variantId) ?? null : null
  if (variantId && !variant) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }
  if (variants.length > 0 && !variant) {
    return NextResponse.json({ error: 'Choose an option first.' }, { status: 400 })
  }

  // All three effects of ordering — the units off the shelf, the request row,
  // the receivable — in one place, so the count they each use is the same
  // number. Adding the same thing again GROWS the pending order rather than
  // returning it untouched, which is what "add 2 more" has to mean; a CANCELLED
  // row is never a match (AGENTS.md #7).
  //
  // The ledger line names both the client it went to and the trainer who did
  // it, which is the pair you need when a count looks wrong a fortnight later.
  const result = await placeProductOrder({
    trainerId: access.client.trainerId,
    clientId,
    product: {
      id: product.id,
      name: product.name,
      stockCount: product.stockCount,
      variant: variant ? { id: variant.id, name: variant.name, stockCount: variant.stockCount } : null,
    },
    quantity: parsed.data.quantity,
    note: parsed.data.note ?? null,
    userId: session.user.id,
    stockNote: 'Added to a client by their trainer',
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json(result.request, { status: result.created ? 201 : 200 })
}
