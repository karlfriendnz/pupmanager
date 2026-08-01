import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

// A trainer's shop categories.
//
// They exist as rows so a category can be made before it has anything in it,
// renamed in one place, and dragged into the order the trainer wants — none of
// which a free-form string on each product could do.
export const runtime = 'nodejs'

const schema = z.object({ name: z.string().trim().min(1).max(60) })

export async function GET() {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard

  const categories = await prisma.productCategory.findMany({
    where: { trainerId: guard.companyId },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, order: true, _count: { select: { products: true } } },
  })
  return NextResponse.json({
    categories: categories.map(c => ({ id: c.id, name: c.name, order: c.order, products: c._count.products })),
  })
}

export async function POST(req: Request) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Name the category' }, { status: 400 })
  const name = parsed.data.name

  // Same name twice would split the shelf in two, so it is refused with a
  // sentence rather than a unique-constraint stack trace.
  const clash = await prisma.productCategory.findFirst({
    where: { trainerId: guard.companyId, name },
    select: { id: true },
  })
  if (clash) return NextResponse.json({ error: `You already have a “${name}” category.` }, { status: 409 })

  // New ones go on the end, where the trainer just looked.
  const last = await prisma.productCategory.findFirst({
    where: { trainerId: guard.companyId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })

  const created = await prisma.productCategory.create({
    data: { trainerId: guard.companyId, name, order: (last?.order ?? -1) + 1 },
    select: { id: true, name: true, order: true },
  })
  return NextResponse.json({ ...created, products: 0 }, { status: 201 })
}
