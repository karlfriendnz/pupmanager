import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  kind: z.enum(['PHYSICAL', 'DIGITAL']).optional(),
  priceCents: z.number().int().min(0).nullable().optional(),
  imageUrl: z.string().url().optional().or(z.literal('')).nullable(),
  downloadUrl: z.string().url().optional().or(z.literal('')).nullable(),
  category: z.string().max(60).nullable().optional(),
  featured: z.boolean().optional(),
  xeroAccountCode: z.string().max(50).nullable().optional(),
  active: z.boolean().optional(),
  order: z.number().int().optional(),
  // Tri-state "require payment to buy": null = inherit trainer default.
  requirePayment: z.boolean().nullable().optional(),
})

async function ownsProduct(productId: string, trainerId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, trainerId: true },
  })
  return product?.trainerId === trainerId ? product : null
}

export async function PATCH(req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { productId } = await params
  const owned = await ownsProduct(productId, trainerId)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data
  const product = await prisma.product.update({
    where: { id: productId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description || null }),
      ...(data.kind !== undefined && { kind: data.kind }),
      ...(data.priceCents !== undefined && { priceCents: data.priceCents }),
      ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl || null }),
      ...(data.downloadUrl !== undefined && { downloadUrl: data.downloadUrl || null }),
      ...(data.category !== undefined && { category: data.category?.trim() || null }),
      ...(data.featured !== undefined && { featured: data.featured }),
      ...(data.xeroAccountCode !== undefined && { xeroAccountCode: data.xeroAccountCode || null }),
      ...(data.active !== undefined && { active: data.active }),
      ...(data.order !== undefined && { order: data.order }),
      ...(data.requirePayment !== undefined && { requirePayment: data.requirePayment }),
    },
  })
  return NextResponse.json(product)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { productId } = await params
  const owned = await ownsProduct(productId, trainerId)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.product.delete({ where: { id: productId } })
  return NextResponse.json({ ok: true })
}
