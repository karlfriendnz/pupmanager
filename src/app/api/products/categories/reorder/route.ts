import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

// The order the shelves appear in. Same shape as the product reorder: ids in
// their new order, index becomes `order`.
export const runtime = 'nodejs'

const schema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) })

export async function POST(req: Request) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })
  const { ids } = parsed.data

  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: 'Duplicate ids' }, { status: 400 })
  }

  const mine = await prisma.productCategory.count({
    where: { id: { in: ids }, trainerId: guard.companyId },
  })
  if (mine !== ids.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.productCategory.update({ where: { id }, data: { order: index } }),
    ),
  )
  return NextResponse.json({ ok: true })
}
