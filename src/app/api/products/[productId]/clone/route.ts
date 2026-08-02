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
export const runtime = 'nodejs'

export async function POST(_req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard

  const { productId } = await params

  const original = await prisma.product.findFirst({
    where: { id: productId, trainerId: guard.companyId },
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
      },
    })
  })

  return NextResponse.json({ id: copy.id, name: copy.name }, { status: 201 })
}
