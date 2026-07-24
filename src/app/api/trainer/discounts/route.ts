import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { discountCreateSchema } from '@/lib/discounts/input'

// System-wide discounts. List (optionally for one offering) + create. Guarded by
// classes.manage; a package-scoped discount must attach to the trainer's own
// package. Trainer-wide discounts (no packageId) are available to any offering.

export async function GET(req: Request) {
  const ctx = await guardPermission('classes.manage')
  if (ctx instanceof NextResponse) return ctx
  const packageId = new URL(req.url).searchParams.get('packageId')

  const discounts = await prisma.discount.findMany({
    where: { trainerId: ctx.companyId, ...(packageId ? { packageId } : {}) },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json(discounts)
}

export async function POST(req: Request) {
  const ctx = await guardPermission('classes.manage')
  if (ctx instanceof NextResponse) return ctx

  const parsed = discountCreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { packageId, ...data } = parsed.data

  // A package-scoped discount may only attach to the trainer's own offering.
  if (packageId) {
    const owned = await prisma.package.findFirst({ where: { id: packageId, trainerId: ctx.companyId }, select: { id: true } })
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const last = await prisma.discount.findFirst({
    where: { trainerId: ctx.companyId, packageId: packageId ?? null },
    orderBy: { order: 'desc' },
    select: { order: true },
  })

  const discount = await prisma.discount.create({
    data: {
      trainerId: ctx.companyId,
      packageId: packageId ?? null,
      name: data.name,
      formText: data.formText ?? null,
      modifierType: data.modifierType,
      modifierValue: data.modifierValue,
      applyTo: data.applyTo,
      conditions: data.conditions,
      isActive: data.isActive ?? true,
      validFrom: data.validFrom ? new Date(data.validFrom) : null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      maxUses: data.maxUses ?? null,
      order: (last?.order ?? -1) + 1,
    },
  })
  return NextResponse.json(discount, { status: 201 })
}
