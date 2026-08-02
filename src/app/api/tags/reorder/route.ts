import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardAnyPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { MAX_TAGS_PER_TRAINER } from '@/lib/tags'

// The order the tags appear in — for the trainer's rail AND for the client's
// browse screen, which reads the same column. Same shape as the product
// category reorder: ids in their new order, index becomes `order`.
export const runtime = 'nodejs'

const schema = z.object({ ids: z.array(z.string().min(1)).min(1).max(MAX_TAGS_PER_TRAINER) })

export async function POST(req: Request) {
  const guard = await guardAnyPermission('packages.manage', 'products.manage')
  if (guard instanceof NextResponse) return guard

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })
  const { ids } = parsed.data

  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: 'Duplicate ids' }, { status: 400 })
  }

  // Every id has to be this business's — one belonging to another trainer
  // would otherwise have its order rewritten from here.
  const mine = await prisma.tag.count({ where: { id: { in: ids }, trainerId: guard.companyId } })
  if (mine !== ids.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.$transaction(
    ids.map((id, index) => prisma.tag.update({ where: { id }, data: { order: index } })),
  )
  return NextResponse.json({ ok: true })
}
