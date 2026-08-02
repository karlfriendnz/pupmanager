import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardAnyPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { MAX_TAGS_PER_TRAINER, TAG_NAME_MAX, normalizeTagName, tagNameKey } from '@/lib/tags'

// A trainer's tag list — the one flat set of labels that reaches offerings AND
// products. Gated on EITHER catalogue permission, because a tag belongs to
// both: see guardAnyPermission.
export const runtime = 'nodejs'

const schema = z.object({ name: z.string().trim().min(1).max(TAG_NAME_MAX) })

export async function GET() {
  const guard = await guardAnyPermission('packages.manage', 'products.manage')
  if (guard instanceof NextResponse) return guard

  const tags = await prisma.tag.findMany({
    where: { trainerId: guard.companyId },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, order: true, _count: { select: { items: true } } },
  })
  return NextResponse.json({
    tags: tags.map(t => ({ id: t.id, name: t.name, order: t.order, items: t._count.items })),
  })
}

export async function POST(req: Request) {
  const guard = await guardAnyPermission('packages.manage', 'products.manage')
  if (guard instanceof NextResponse) return guard

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Name the tag' }, { status: 400 })
  const name = normalizeTagName(parsed.data.name)
  const nameKey = tagNameKey(name)

  // Refused with a sentence rather than a unique-constraint stack trace — and
  // matched case-insensitively, so "puppy" cannot become a second "Puppy".
  const clash = await prisma.tag.findFirst({
    where: { trainerId: guard.companyId, nameKey },
    select: { id: true, name: true },
  })
  if (clash) {
    return NextResponse.json({ error: `You already have a “${clash.name}” tag.` }, { status: 409 })
  }

  const count = await prisma.tag.count({ where: { trainerId: guard.companyId } })
  if (count >= MAX_TAGS_PER_TRAINER) {
    return NextResponse.json({ error: `That's the ${MAX_TAGS_PER_TRAINER}-tag limit.` }, { status: 400 })
  }

  // New ones go on the end, where the trainer just looked.
  const last = await prisma.tag.findFirst({
    where: { trainerId: guard.companyId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })

  const created = await prisma.tag.create({
    data: { trainerId: guard.companyId, name, nameKey, order: (last?.order ?? -1) + 1 },
    select: { id: true, name: true, order: true },
  })
  return NextResponse.json({ ...created, items: 0 }, { status: 201 })
}
