import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

// Drag-and-drop order for the shop.
//
// The ids arrive in the order they now appear and their INDEX becomes `order`.
// Sending positions instead would let two rows claim the same slot; an ordered
// list cannot.
export const runtime = 'nodejs'

const schema = z.object({
  // Optional: reordering happens WITHIN a category, so only that category's
  // products are renumbered. Null means the Uncategorised shelf.
  categoryId: z.string().nullable().optional(),
  ids: z.array(z.string().min(1)).min(1).max(500),
})

export async function POST(req: Request) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })
  const { ids } = parsed.data

  // A duplicate id would write two positions for one row.
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: 'Duplicate ids' }, { status: 400 })
  }

  // Every id must be this trainer's. One that is not means the whole request is
  // wrong, so nothing is written — a partial reorder is worse than none.
  const mine = await prisma.product.count({ where: { id: { in: ids }, trainerId: guard.companyId } })
  if (mine !== ids.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.product.update({ where: { id }, data: { order: index } }),
    ),
  )
  return NextResponse.json({ ok: true })
}
