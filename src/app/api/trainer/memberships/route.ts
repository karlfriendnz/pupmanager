import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { membershipCreateSchema, itemsOwnedByTrainer, itemRows, planRows } from '@/lib/membership-input'

// Trainer-owned combo memberships. List + create. Guarded by packages.manage;
// every included item must reference an offering the trainer owns.

export async function GET() {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx

  const memberships = await prisma.membership.findMany({
    where: { trainerId: ctx.companyId },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    include: { _count: { select: { items: true, purchases: true } } },
  })
  return NextResponse.json(memberships)
}

export async function POST(req: Request) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  // Memberships are an add-on — no creating one while it's switched off.
  if (!(await hasAddon(ctx.companyId, 'memberships'))) {
    return NextResponse.json({ error: 'Turn the Packages add-on on first.' }, { status: 403 })
  }

  const parsed = membershipCreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  const created = await prisma.$transaction(async tx => {
    if (d.items.length && !(await itemsOwnedByTrainer(tx, ctx.companyId, d.items))) return null
    const last = await tx.membership.findFirst({ where: { trainerId: ctx.companyId }, orderBy: { order: 'desc' }, select: { order: true } })
    const m = await tx.membership.create({
      data: {
        trainerId: ctx.companyId, name: d.name, description: d.description ?? null, imageUrl: d.imageUrl ?? null,
        bgColor: d.bgColor ?? null, headerColor: d.headerColor ?? null, textColor: d.textColor ?? null, featuredColor: d.featuredColor ?? null,
        buttonBgColor: d.buttonBgColor ?? null, buttonTextColor: d.buttonTextColor ?? null, buttonText: d.buttonText ?? null,
        priceCents: d.priceCents, cadence: d.cadence, interval: d.interval ?? null,
        minTermCount: d.minTermCount ?? 0, earlyTermFeeCents: d.earlyTermFeeCents ?? null,
        published: d.published ?? false, order: (last?.order ?? -1) + 1,
        eligibility: d.eligibility ?? 'PUBLIC', showWhenLocked: d.showWhenLocked ?? true,
      },
    })
    if (d.items.length) await tx.membershipItem.createMany({ data: itemRows(m.id, d.items) })
    if (d.plans?.length) await tx.membershipPlan.createMany({ data: planRows(m.id, d.plans) })
    // Same ownership rule as the edit route: a package can only ever be gated
    // on achievements this trainer can actually award.
    const prereqIds = [...new Set(d.prerequisiteAchievementIds ?? [])]
    if (prereqIds.length) {
      const mine = await tx.achievement.count({ where: { id: { in: prereqIds }, trainerId: ctx.companyId } })
      if (mine !== prereqIds.length) return null
      await tx.membershipPrerequisite.createMany({
        data: prereqIds.map(achievementId => ({ membershipId: m.id, achievementId })),
        skipDuplicates: true,
      })
    }
    return m
  })

  if (!created) return NextResponse.json({ error: 'An included offering isn’t yours' }, { status: 404 })
  return NextResponse.json(created, { status: 201 })
}
