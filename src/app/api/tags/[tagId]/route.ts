import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardAnyPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { TAG_NAME_MAX, normalizeTagName, tagNameKey } from '@/lib/tags'

export const runtime = 'nodejs'

const patchSchema = z.object({ name: z.string().trim().min(1).max(TAG_NAME_MAX) })

/** Tenant-scoped: another business's id resolves to nothing and 404s. */
async function owned(trainerId: string, id: string) {
  return prisma.tag.findFirst({ where: { id, trainerId }, select: { id: true } })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ tagId: string }> }) {
  const guard = await guardAnyPermission('packages.manage', 'products.manage')
  if (guard instanceof NextResponse) return guard
  const { tagId } = await params
  if (!(await owned(guard.companyId, tagId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Name the tag' }, { status: 400 })
  const name = normalizeTagName(parsed.data.name)
  const nameKey = tagNameKey(name)

  const clash = await prisma.tag.findFirst({
    where: { trainerId: guard.companyId, nameKey, id: { not: tagId } },
    select: { id: true, name: true },
  })
  if (clash) {
    return NextResponse.json({ error: `You already have a “${clash.name}” tag.` }, { status: 409 })
  }

  // Renaming a tag changes only the tag. Everything in it stays in it — the
  // assignments point at the id, never at the word.
  const updated = await prisma.tag.update({
    where: { id: tagId },
    data: { name, nameKey },
    select: { id: true, name: true, order: true },
  })
  return NextResponse.json(updated)
}

/**
 * Delete a tag, NOT what it labelled.
 *
 * The join rows go (the FK cascades from tags → tag_assignments and stops
 * there); every course, session and product it pointed at is untouched and
 * stays on sale. A trainer tidying their labels must never lose their
 * catalogue by removing a word.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ tagId: string }> }) {
  const guard = await guardAnyPermission('packages.manage', 'products.manage')
  if (guard instanceof NextResponse) return guard
  const { tagId } = await params
  if (!(await owned(guard.companyId, tagId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const untagged = await prisma.$transaction(async tx => {
    const n = await tx.tagAssignment.deleteMany({ where: { tagId } })
    await tx.tag.delete({ where: { id: tagId } })
    return n.count
  })

  return NextResponse.json({ ok: true, untagged })
}
