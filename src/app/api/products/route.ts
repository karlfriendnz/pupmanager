import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  kind: z.enum(['PHYSICAL', 'DIGITAL']).default('PHYSICAL'),
  priceCents: z.number().int().min(0).optional().nullable(),
  imageUrl: z.string().url().optional().or(z.literal('')).nullable(),
  downloadUrl: z.string().url().optional().or(z.literal('')).nullable(),
  category: z.string().max(60).optional().nullable(),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
})

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const products = await prisma.product.findMany({
    where: { trainerId },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
  })
  return NextResponse.json(products)
}

export async function POST(req: Request) {
  const guard = await guardPermission('products.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const product = await prisma.product.create({
    data: {
      trainerId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      kind: parsed.data.kind,
      priceCents: parsed.data.priceCents ?? null,
      imageUrl: parsed.data.imageUrl || null,
      downloadUrl: parsed.data.downloadUrl || null,
      category: parsed.data.category?.trim() || null,
      featured: parsed.data.featured ?? false,
      active: parsed.data.active ?? true,
    },
  })
  return NextResponse.json(product, { status: 201 })
}
