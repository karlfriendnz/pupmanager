import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { optionalAssetUrlSchema } from '@/lib/asset-url'
import { validateSalePrice } from '@/lib/product-price'
import { setStockCount } from '@/lib/stock'

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  // Rich text (Tiptap HTML) — see the create route for why this is generous.
  description: z.string().max(20_000).nullable().optional(),
  kind: z.enum(['PHYSICAL', 'DIGITAL']).optional(),
  priceCents: z.number().int().min(0).nullable().optional(),
  // Optional sale price; null clears it and restores normal pricing.
  salePriceCents: z.number().int().min(0).nullable().optional(),
  imageUrl: optionalAssetUrlSchema(),
  downloadUrl: optionalAssetUrlSchema(),
  category: z.string().max(60).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  featured: z.boolean().optional(),
  xeroAccountCode: z.string().max(50).nullable().optional(),
  // Units on hand. Null clears tracking ("I never run out of this").
  stockCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  active: z.boolean().optional(),
  order: z.number().int().optional(),
  // Tri-state "require payment to buy": null = inherit trainer default.
  requirePayment: z.boolean().nullable().optional(),
})

async function ownsProduct(productId: string, trainerId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    // Prices come back too: a PATCH may move only one half of the pair, and the
    // sale-price rule has to be checked against the row as it WILL be.
    select: { id: true, trainerId: true, priceCents: true, salePriceCents: true },
  })
  return product?.trainerId === trainerId ? product : null
}

export async function PATCH(req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { productId } = await params
  const owned = await ownsProduct(productId, trainerId)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data

  // Validate the pair as it will be after this patch, not as it was sent.
  const nextPrice = data.priceCents !== undefined ? data.priceCents : owned.priceCents
  const nextSale = data.salePriceCents !== undefined ? data.salePriceCents : owned.salePriceCents
  const priceError = validateSalePrice(nextPrice, nextSale)
  if (priceError) return NextResponse.json({ error: priceError }, { status: 400 })

  // Stock is NOT patched inline with the rest. A number typed over this field
  // is a trainer saying "I counted, it is nine" — or, on a product that had no
  // count at all, "start counting this" — and both have to leave a line in the
  // ledger or the balance and its history part company on the quietest edit
  // there is. setStockCount is the only writer that knows which of the two it
  // was looking at.
  const product = await prisma.$transaction(async tx => {
    const updated = await tx.product.update({
      where: { id: productId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description || null }),
        ...(data.kind !== undefined && { kind: data.kind }),
        ...(data.priceCents !== undefined && { priceCents: data.priceCents }),
        ...(data.salePriceCents !== undefined && { salePriceCents: data.salePriceCents }),
        ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl || null }),
        ...(data.downloadUrl !== undefined && { downloadUrl: data.downloadUrl || null }),
        ...(data.category !== undefined && { category: data.category?.trim() || null }),
        ...(data.categoryId !== undefined && { categoryId: data.categoryId || null }),
        ...(data.featured !== undefined && { featured: data.featured }),
        ...(data.xeroAccountCode !== undefined && { xeroAccountCode: data.xeroAccountCode || null }),
        ...(data.active !== undefined && { active: data.active }),
        ...(data.order !== undefined && { order: data.order }),
        ...(data.requirePayment !== undefined && { requirePayment: data.requirePayment }),
      },
    })
    if (data.stockCount === undefined) return updated
    const stockCount = await setStockCount(tx, productId, data.stockCount, {
      userId: session.user.id,
    })
    return { ...updated, stockCount }
  })
  return NextResponse.json(product)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { productId } = await params
  const owned = await ownsProduct(productId, trainerId)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Money refuses — the same rule the offering DELETE settled on, for the same
  // reason. `ProductRequest.product` is onDelete: Cascade, so deleting a product
  // silently took every order with it: the ones clients are still waiting on,
  // and the fulfilled ones that are the record of what somebody bought. The
  // invoices raised against them survive, pointing at rows that no longer exist
  // (Invoice's sourceType/sourceId link is soft, so nothing at the DB level
  // stops it) — and they are still owed (audit T-7).
  const [pending, invoiced, paid] = await Promise.all([
    prisma.productRequest.count({ where: { productId, status: 'PENDING' } }),
    prisma.invoice.count({ where: { trainerId, sourceType: 'PRODUCT', sourceId: productId } }),
    prisma.paymentItem.count({ where: { productId } }),
  ])
  if (pending > 0) {
    return NextResponse.json(
      {
        error: `${pending} ${pending === 1 ? 'client has' : 'clients have'} this on order. Hand ${pending === 1 ? 'it' : 'them'} over or cancel ${pending === 1 ? 'it' : 'them'} first, then delete it.`,
      },
      { status: 409 },
    )
  }
  if (invoiced > 0 || paid > 0) {
    return NextResponse.json(
      // Same plain-words rule as the package refusal next door.
      { error: 'You have already invoiced a client for this product. Hide it instead, or cancel those invoices first.' },
      { status: 409 },
    )
  }

  await prisma.product.delete({ where: { id: productId } })
  return NextResponse.json({ ok: true })
}
