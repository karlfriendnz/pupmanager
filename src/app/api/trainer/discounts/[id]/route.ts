import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { discountPatchSchema } from '@/lib/discounts/input'

// Update / delete a trainer-owned discount.
async function owned(trainerId: string, id: string) {
  return prisma.discount.findFirst({ where: { id, trainerId }, select: { id: true } })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('classes.manage')
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!(await owned(ctx.companyId, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = discountPatchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  const discount = await prisma.discount.update({
    where: { id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.formText !== undefined ? { formText: d.formText } : {}),
      ...(d.modifierType !== undefined ? { modifierType: d.modifierType } : {}),
      ...(d.modifierValue !== undefined ? { modifierValue: d.modifierValue } : {}),
      ...(d.applyTo !== undefined ? { applyTo: d.applyTo } : {}),
      ...(d.conditions !== undefined ? { conditions: d.conditions } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      ...(d.validFrom !== undefined ? { validFrom: d.validFrom ? new Date(d.validFrom) : null } : {}),
      ...(d.expiresAt !== undefined ? { expiresAt: d.expiresAt ? new Date(d.expiresAt) : null } : {}),
      ...(d.maxUses !== undefined ? { maxUses: d.maxUses } : {}),
    },
  })
  return NextResponse.json(discount)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('classes.manage')
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!(await owned(ctx.companyId, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.discount.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
