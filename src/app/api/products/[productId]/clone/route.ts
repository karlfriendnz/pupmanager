import { NextResponse } from 'next/server'

import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

// Copy a product. Everything about it comes across — the description, the
// price, the picture, the category, the download — because the reason to
// duplicate one is that the copy is nearly the same: two collar sizes differ by
// a word and a number.
//
// THE COPY IS HIDDEN. `active: false`, whatever the original was. A product is
// a shopfront listing, and a duplicate is by definition unfinished — publishing
// "Front-clip harness (copy)" to every client the moment the button is pressed
// is a worse failure than an extra tap to switch it on.
//
// Stock does NOT come across either. Units on hand describe a thing on a shelf,
// and the copy is a different thing; inheriting 12 would overstate what the
// trainer actually has.
//
// VARIANTS DO come across — names, prices, SKUs, their own photo and notes,
// and order, with the counts
// blanked for the reason above. "Small / Medium / Large" is the most laborious
// part of setting a product up and the likeliest reason to duplicate one at
// all; a copy that silently lost them would be worse than no copy.
export const runtime = 'nodejs'

export async function POST(_req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard

  const { productId } = await params

  const original = await prisma.product.findFirst({
    where: { id: productId, trainerId: guard.companyId },
    include: { variants: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] } },
  })
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const copy = await prisma.$transaction(async tx => {
    // Directly below the original, so a trainer duplicating the fourth of nine
    // finds the copy where they were looking rather than at the end of the shop.
    await tx.product.updateMany({
      where: { trainerId: guard.companyId, order: { gt: original.order } },
      data: { order: { increment: 1 } },
    })
    return tx.product.create({
      data: {
        trainerId: original.trainerId,
        name: `${original.name} (copy)`,
        description: original.description,
        kind: original.kind,
        priceCents: original.priceCents,
        salePriceCents: original.salePriceCents,
        imageUrl: original.imageUrl,
        downloadUrl: original.downloadUrl,
        category: original.category,
        categoryId: original.categoryId,
        xeroAccountCode: original.xeroAccountCode,
        requirePayment: original.requirePayment,
        // Deliberately not carried: see the note at the top.
        featured: false,
        active: false,
        stockCount: null,
        order: original.order + 1,
        variants: {
          create: (original.variants ?? []).map((v, i) => ({
            trainerId: original.trainerId,
            name: v.name,
            sku: v.sku,
            priceCents: v.priceCents,
            salePriceCents: v.salePriceCents,
            imageUrl: v.imageUrl,
            description: v.description,
            active: v.active,
            order: i,
            // Blank, for the same reason the product's own count is: this is a
            // different thing, on nobody's shelf yet.
            stockCount: null,
          })),
        },
      },
    })
  })

  return NextResponse.json({ id: copy.id, name: copy.name }, { status: 201 })
}
