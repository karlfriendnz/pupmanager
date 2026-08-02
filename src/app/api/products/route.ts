import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { optionalAssetUrlSchema } from '@/lib/asset-url'
import { validateSalePrice } from '@/lib/product-price'
import { recordOpeningBalance } from '@/lib/stock'

const createSchema = z.object({
  name: z.string().min(1).max(120),
  // Rich text (Tiptap HTML), so the bound is generous — the old 2000 was tight
  // enough that a formatted description could be rejected.
  description: z.string().max(20_000).optional().nullable(),
  kind: z.enum(['PHYSICAL', 'DIGITAL']).default('PHYSICAL'),
  priceCents: z.number().int().min(0).optional().nullable(),
  // Optional sale price. Must sit below priceCents — checked after parsing so
  // the trainer gets the sentence, not a Zod shape.
  salePriceCents: z.number().int().min(0).optional().nullable(),
  imageUrl: optionalAssetUrlSchema(),
  downloadUrl: optionalAssetUrlSchema(),
  category: z.string().max(60).optional().nullable(),
  categoryId: z.string().optional().nullable(),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
  xeroAccountCode: z.string().max(50).optional().nullable(),
  // Tri-state "require payment to buy": null = inherit trainer default.
  requirePayment: z.boolean().nullable().optional(),
  // Units on hand. Null clears tracking ("I never run out of this").
  stockCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
})

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const products = await prisma.product.findMany({
    where: { trainerId },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    // The options come with the product. The instant-sale composer has to make
    // the trainer pick a size before it can ring one up — a varianted product's
    // counts live on the VARIANT rows and Product.stockCount is ignored (see
    // stock.ts), so a sale that named only the product would take a unit off a
    // shelf nobody is counting.
    include: {
      variants: {
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, name: true, priceCents: true, salePriceCents: true,
          stockCount: true, active: true, imageUrl: true,
        },
      },
    },
  })
  return NextResponse.json(products)
}

export async function POST(req: Request) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const priceCents = parsed.data.priceCents ?? null
  const salePriceCents = parsed.data.salePriceCents ?? null
  const priceError = validateSalePrice(priceCents, salePriceCents)
  if (priceError) return NextResponse.json({ error: priceError }, { status: 400 })

  // Created and its opening balance recorded together. A product born with 12
  // on hand has to start its ledger at 12, or the sum of its movements says 0
  // against a shelf holding twelve from the very first day.
  const product = await prisma.$transaction(async tx => {
    const created = await tx.product.create({
      data: {
        trainerId,
        name: parsed.data.name,
        description: parsed.data.description || null,
        kind: parsed.data.kind,
        priceCents,
        salePriceCents,
        stockCount: parsed.data.stockCount ?? null,
        imageUrl: parsed.data.imageUrl || null,
        downloadUrl: parsed.data.downloadUrl || null,
        category: parsed.data.category?.trim() || null,
        categoryId: parsed.data.categoryId || null,
        featured: parsed.data.featured ?? false,
        xeroAccountCode: parsed.data.xeroAccountCode || null,
        requirePayment: parsed.data.requirePayment ?? null,
        active: parsed.data.active ?? true,
      },
    })
    if (created.stockCount !== null) {
      await recordOpeningBalance(tx, {
        productId: created.id,
        trainerId,
        units: created.stockCount,
        userId: session.user.id,
      })
    }
    return created
  })
  return NextResponse.json(product, { status: 201 })
}
