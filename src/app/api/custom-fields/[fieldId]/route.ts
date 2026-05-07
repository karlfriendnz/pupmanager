import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  label: z.string().min(1),
  type: z.enum(['TEXT', 'NUMBER', 'DROPDOWN']),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  category: z.string().optional().nullable(),
  appliesTo: z.enum(['OWNER', 'DOG']).optional(),
})

// Partial-update schema for PATCH (e.g. drag-and-drop changes `category`
// and/or `order`).
const patchSchema = z.object({
  label: z.string().min(1).optional(),
  type: z.enum(['TEXT', 'NUMBER', 'DROPDOWN']).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  category: z.string().nullable().optional(),
  appliesTo: z.enum(['OWNER', 'DOG']).optional(),
  order: z.number().int().min(0).optional(),
})

async function getField(fieldId: string, userId: string) {
  const trainer = await prisma.trainerProfile.findUnique({ where: { userId }, select: { id: true } })
  if (!trainer) return null
  return prisma.customField.findFirst({ where: { id: fieldId, trainerId: trainer.id } })
}

export async function PUT(req: Request, { params }: { params: Promise<{ fieldId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { fieldId } = await params
  const field = await getField(fieldId, session.user.id)
  if (!field) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const updated = await prisma.customField.update({
    where: { id: fieldId },
    data: {
      label: parsed.data.label,
      type: parsed.data.type,
      required: parsed.data.required,
      options: parsed.data.options && parsed.data.options.length > 0 ? parsed.data.options : undefined,
      category: parsed.data.category ?? null,
      ...(parsed.data.appliesTo ? { appliesTo: parsed.data.appliesTo } : {}),
    },
  })
  return NextResponse.json(updated)
}

// Partial update — only the keys present in the body are touched. Used by
// drag-and-drop in the intake editor to flip `category` without resending the
// whole field.
export async function PATCH(req: Request, { params }: { params: Promise<{ fieldId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { fieldId } = await params
  const field = await getField(fieldId, session.user.id)
  if (!field) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const updated = await prisma.customField.update({
    where: { id: fieldId },
    data: {
      ...(parsed.data.label !== undefined && { label: parsed.data.label }),
      ...(parsed.data.type !== undefined && { type: parsed.data.type }),
      ...(parsed.data.required !== undefined && { required: parsed.data.required }),
      ...(parsed.data.options !== undefined && { options: parsed.data.options.length > 0 ? parsed.data.options : undefined }),
      ...(parsed.data.category !== undefined && { category: parsed.data.category ?? null }),
      ...(parsed.data.appliesTo !== undefined && { appliesTo: parsed.data.appliesTo }),
      ...(parsed.data.order !== undefined && { order: parsed.data.order }),
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(req: Request, { params }: { params: Promise<{ fieldId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { fieldId } = await params
  const field = await getField(fieldId, session.user.id)
  if (!field) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.customField.delete({ where: { id: fieldId } })
  return NextResponse.json({ ok: true })
}
