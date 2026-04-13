import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const fieldSchema = z.object({
  type: z.enum(['TEXT', 'MULTIPLE_CHOICE', 'DROPDOWN']),
  label: z.string().min(1),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  order: z.number().default(0),
})

const sectionSchema = z.object({
  title: z.string().min(1),
  order: z.number().default(0),
  fields: z.array(fieldSchema),
})

const schema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  isPublished: z.boolean().default(false),
  sections: z.array(sectionSchema),
})

async function getTrainerForm(formId: string, userId: string) {
  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (!trainerProfile) return null

  return prisma.intakeForm.findFirst({
    where: { id: formId, trainerId: trainerProfile.id },
    include: { sections: { orderBy: { order: 'asc' }, include: { fields: { orderBy: { order: 'asc' } } } } },
  })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const { formId } = await params
  const form = await getTrainerForm(formId, session.user.id)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(form)
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const { formId } = await params
  const form = await getTrainerForm(formId, session.user.id)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { name, description, isPublished, sections } = parsed.data

  const updated = await prisma.$transaction(async tx => {
    // Delete existing sections (cascades to fields)
    await tx.formSection.deleteMany({ where: { formId } })
    return tx.intakeForm.update({
      where: { id: formId },
      data: {
        name,
        description,
        isPublished,
        sections: {
          create: sections.map(s => ({
            title: s.title,
            order: s.order,
            fields: {
              create: s.fields.map(f => ({
                type: f.type,
                label: f.label,
                required: f.required,
                options: f.options && f.options.length > 0 ? f.options : undefined,
                order: f.order,
              })),
            },
          })),
        },
      },
      include: { sections: { orderBy: { order: 'asc' }, include: { fields: { orderBy: { order: 'asc' } } } } },
    })
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const { formId } = await params
  const form = await getTrainerForm(formId, session.user.id)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.intakeForm.delete({ where: { id: formId } })
  return NextResponse.json({ ok: true })
}
