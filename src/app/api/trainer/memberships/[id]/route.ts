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
      // A plan someone is actually subscribed to must NOT be deleted. Stripe
      // Prices are immutable and a live subscription bills against the Price
      // minted from its plan row — dropping the row would strip planId off the
      // purchase and lose the price, term and interval that client agreed to.
      //
      // So: archive the ones with live subscribers (they stop being sold, but
      // keep billing exactly as agreed), delete the rest, then write the new
      // set. A price edit therefore applies to NEW subscribers only, which is
      // the whole point — nobody's monthly charge changes behind their back.
      const subscribed = await tx.membershipPurchase.findMany({
        where: {
          membershipId: id,
          planId: { not: null },
          status: { in: ['ACTIVE', 'PAST_DUE', 'CANCELLING'] },
        },
        select: { planId: true },
        distinct: ['planId'],
      })
      const keepIds = subscribed.map(s => s.planId).filter((p): p is string => !!p)

      if (keepIds.length) {
        await tx.membershipPlan.updateMany({
          where: { membershipId: id, id: { in: keepIds }, archivedAt: null },
          data: { archivedAt: new Date() },
        })
      }
      await tx.membershipPlan.deleteMany({
        where: { membershipId: id, ...(keepIds.length ? { id: { notIn: keepIds } } : {}) },
      })
      // New rows carry null Stripe ids, so the next sale mints a fresh Price
      // rather than reusing one built for a different amount.
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
