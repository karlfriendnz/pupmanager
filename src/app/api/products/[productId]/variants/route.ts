import { NextResponse } from 'next/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { optionalAssetUrlSchema } from '@/lib/asset-url'
import { validateSalePrice } from '@/lib/product-price'
import { isRichTextEmpty } from '@/lib/rich-text'
import { recordOpeningBalance } from '@/lib/stock'

// One product's variants — "Small", "Large", "Red · Large".
//
// The whole list is sent at once (PUT), not a row at a time. The editor is a
// drag-to-reorder list where renaming one row and moving another are the same
// gesture to a trainer, and reconciling here means the order can never be a
// separate request that half-lands.
//
// Scoped by guard.companyId on both the product AND every variant id sent, so
// a request naming another business's variant creates nothing and moves
// nothing.
export const runtime = 'nodejs'

const variantSchema = z.object({
  // Absent = a new row. Present = update the one with this id, if it is ours.
  id: z.string().optional(),
  name: z.string().min(1).max(80),
  sku: z.string().max(60).nullable().optional(),
  // Null = inherit the product's price. That is the common case and the
  // default, so five sizes at one price is typed once.
  priceCents: z.number().int().min(0).nullable().optional(),
  salePriceCents: z.number().int().min(0).nullable().optional(),
  imageUrl: optionalAssetUrlSchema(),
  // Null = inherit the product's description. Tiptap HTML, capped at the same
  // order of magnitude a product blurb is: this is a size note, not an article.
  description: z.string().max(20_000).nullable().optional(),
  // Only read when the row is NEW — see below.
  stockCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  active: z.boolean().optional(),
})

const putSchema = z.object({
  // A shop can carry a lot of sizes, but a hundred rows on one product is a
  // mis-click or an import gone wrong, not a catalogue.
  variants: z.array(variantSchema).max(100),
})

async function ownedProduct(productId: string, companyId: string) {
  return prisma.product.findFirst({
    where: { id: productId, trainerId: companyId },
    select: { id: true, trainerId: true, priceCents: true, salePriceCents: true },
  })
}

function serialise(v: {
  id: string
  name: string
  sku: string | null
  priceCents: number | null
  salePriceCents: number | null
  imageUrl: string | null
  description: string | null
  stockCount: number | null
  active: boolean
  order: number
}) {
  return v
}

export async function GET(_req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard

  const { productId } = await params
  const product = await ownedProduct(productId, guard.companyId)
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const variants = await prisma.productVariant.findMany({
    where: { productId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, name: true, sku: true, priceCents: true, salePriceCents: true,
      imageUrl: true, description: true, stockCount: true, active: true, order: true,
    },
  })
  return NextResponse.json({ variants: variants.map(serialise) })
}

export async function PUT(req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  const userId = session?.user?.id ?? null

  const { productId } = await params
  const product = await ownedProduct(productId, guard.companyId)
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const sent = parsed.data.variants

  // A variant's own sale price obeys the same rule the product's does, against
  // whichever price it will actually be shown at — its own, or the inherited
  // one. Otherwise a variant could advertise a "sale" dearer than the price
  // beside it.
  for (const v of sent) {
    const price = v.priceCents !== undefined && v.priceCents !== null ? v.priceCents : product.priceCents
    const problem = v.salePriceCents == null ? null : validateSalePrice(price, v.salePriceCents)
    if (problem) return NextResponse.json({ error: `${v.name}: ${problem}` }, { status: 400 })
  }

  const existing = await prisma.productVariant.findMany({
    where: { productId },
    select: { id: true, stockCount: true },
  })
  const known = new Map(existing.map(v => [v.id, v]))
  const keptIds = new Set(sent.map(v => v.id).filter((id): id is string => !!id && known.has(id)))

  await prisma.$transaction(async tx => {
    // Gone from the list = removed. The ProductRequests and PaymentItems that
    // point at it survive with a null variantId (SET NULL), because a client
    // still bought something even after the trainer stopped stocking that size.
    const removed = existing.filter(v => !keptIds.has(v.id)).map(v => v.id)
    if (removed.length) await tx.productVariant.deleteMany({ where: { id: { in: removed }, productId } })

    for (const [index, v] of sent.entries()) {
      const base = {
        name: v.name.trim(),
        sku: v.sku?.trim() || null,
        priceCents: v.priceCents ?? null,
        salePriceCents: v.salePriceCents ?? null,
        active: v.active ?? true,
        order: index,
        // Only when the key was actually SENT. A caller that doesn't manage
        // the picture must not blank it just by saving a rename; an absent key
        // means "leave it", not "clear it".
        ...(v.imageUrl !== undefined ? { imageUrl: v.imageUrl || null } : {}),
        // Same rule for the words — and emptied-out rich text is stored as
        // NULL, not as `<p></p>`. A variant whose description is an empty
        // document would otherwise override the product's blurb with nothing,
        // and the shop would show a blank where the product's words used to be
        // while the editor showed nothing wrong. NULL means inherit, so an
        // emptied field has to become NULL to mean what the trainer intended.
        ...(v.description !== undefined
          ? { description: isRichTextEmpty(v.description) ? null : v.description }
          : {}),
      }

      if (v.id && known.has(v.id)) {
        // NOTE: no stockCount. On a variant that exists the LEDGER owns the
        // count — it moves through the stock sheet, which asks what happened
        // and writes a movement. Letting this route set it would silently undo
        // whatever was recorded while the editor sat open, which is the exact
        // trap the product form already avoids.
        await tx.productVariant.update({ where: { id: v.id }, data: base })
        continue
      }

      // A brand-new variant may be born with a count, and it has to open its
      // ledger at that number or the movements sum to 0 against a shelf that
      // holds six from day one.
      const created = await tx.productVariant.create({
        data: { ...base, productId, trainerId: product.trainerId, stockCount: v.stockCount ?? null },
        select: { id: true, stockCount: true },
      })
      if (created.stockCount != null && created.stockCount > 0) {
        await recordOpeningBalance(tx, {
          productId,
          trainerId: product.trainerId,
          units: created.stockCount,
          userId,
          variantId: created.id,
        })
      }
    }
  })

  const variants = await prisma.productVariant.findMany({
    where: { productId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, name: true, sku: true, priceCents: true, salePriceCents: true,
      imageUrl: true, description: true, stockCount: true, active: true, order: true,
    },
  })
  return NextResponse.json({ variants: variants.map(serialise) })
}
