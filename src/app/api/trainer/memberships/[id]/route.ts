import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { membershipPatchSchema, itemsOwnedByTrainer, itemRows, planRows } from '@/lib/membership-input'

async function owned(trainerId: string, id: string) {
  return prisma.membership.findFirst({ where: { id, trainerId }, select: { id: true } })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  const membership = await prisma.membership.findFirst({
    where: { id, trainerId: ctx.companyId },
    include: { items: { orderBy: { order: 'asc' } }, plans: { orderBy: { order: 'asc' } } },
  })
  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(membership)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!(await owned(ctx.companyId, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = membershipPatchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  const result = await prisma.$transaction(async tx => {
    // Replace the item set only when items were sent.
    if (d.items !== undefined) {
      if (d.items.length && !(await itemsOwnedByTrainer(tx, ctx.companyId, d.items))) return null
      await tx.membershipItem.deleteMany({ where: { membershipId: id } })
      if (d.items.length) await tx.membershipItem.createMany({ data: itemRows(id, d.items) })
    }
    if (d.plans !== undefined) {
      await tx.membershipPlan.deleteMany({ where: { membershipId: id } })
      if (d.plans.length) await tx.membershipPlan.createMany({ data: planRows(id, d.plans) })
    }
    return tx.membership.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.imageUrl !== undefined ? { imageUrl: d.imageUrl } : {}),
        ...(d.bgColor !== undefined ? { bgColor: d.bgColor } : {}),
        ...(d.headerColor !== undefined ? { headerColor: d.headerColor } : {}),
        ...(d.textColor !== undefined ? { textColor: d.textColor } : {}),
        ...(d.featuredColor !== undefined ? { featuredColor: d.featuredColor } : {}),
        ...(d.buttonBgColor !== undefined ? { buttonBgColor: d.buttonBgColor } : {}),
        ...(d.buttonTextColor !== undefined ? { buttonTextColor: d.buttonTextColor } : {}),
        ...(d.buttonText !== undefined ? { buttonText: d.buttonText } : {}),
        ...(d.priceCents !== undefined ? { priceCents: d.priceCents } : {}),
        ...(d.cadence !== undefined ? { cadence: d.cadence } : {}),
        ...(d.interval !== undefined ? { interval: d.interval } : {}),
        ...(d.minTermCount !== undefined ? { minTermCount: d.minTermCount } : {}),
        ...(d.earlyTermFeeCents !== undefined ? { earlyTermFeeCents: d.earlyTermFeeCents } : {}),
        ...(d.published !== undefined ? { published: d.published } : {}),
      },
      include: { items: { orderBy: { order: 'asc' } }, plans: { orderBy: { order: 'asc' } } },
    })
  })

  if (!result) return NextResponse.json({ error: 'An included offering isn’t yours' }, { status: 404 })
  return NextResponse.json(result)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!(await owned(ctx.companyId, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.membership.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
