import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const patchSchema = z.object({ name: z.string().trim().min(1).max(60) })

/** Tenant-scoped: another business's id resolves to nothing and 404s. */
async function owned(trainerId: string, id: string) {
  return prisma.productCategory.findFirst({ where: { id, trainerId }, select: { id: true, name: true } })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard
  const { categoryId } = await params
  if (!(await owned(guard.companyId, categoryId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Name the category' }, { status: 400 })
  const name = parsed.data.name

  const clash = await prisma.productCategory.findFirst({
    where: { trainerId: guard.companyId, name, id: { not: categoryId } },
    select: { id: true },
  })
  if (clash) return NextResponse.json({ error: `You already have a “${name}” category.` }, { status: 409 })

  // The legacy string on each product is kept in step, so anything still
  // reading `product.category` sees the new name rather than the old one.
  const [updated] = await prisma.$transaction([
    prisma.productCategory.update({ where: { id: categoryId }, data: { name }, select: { id: true, name: true } }),
    prisma.product.updateMany({ where: { categoryId, trainerId: guard.companyId }, data: { category: name } }),
  ])
  return NextResponse.json(updated)
}

/**
 * Delete a category, NOT what is in it.
 *
 * The products fall back to Uncategorised and stay on sale. A trainer tidying
 * their shelves must never lose stock by renaming a shelf.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard
  const { categoryId } = await params
  if (!(await owned(guard.companyId, categoryId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const moved = await prisma.$transaction(async tx => {
    const n = await tx.product.updateMany({
      where: { categoryId, trainerId: guard.companyId },
      data: { categoryId: null, category: null },
    })
    await tx.productCategory.delete({ where: { id: categoryId } })
    return n.count
  })

  return NextResponse.json({ ok: true, movedToUncategorised: moved })
}
