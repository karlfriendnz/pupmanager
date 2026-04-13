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

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!trainerProfile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const forms = await prisma.intakeForm.findMany({
    where: { trainerId: trainerProfile.id },
    include: {
      _count: { select: { submissions: true } },
      sections: { include: { fields: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(forms)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!trainerProfile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { name, description, isPublished, sections } = parsed.data

  const form = await prisma.intakeForm.create({
    data: {
      name,
      description,
      isPublished,
      trainerId: trainerProfile.id,
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
    include: { sections: { include: { fields: true } } },
  })

  return NextResponse.json(form, { status: 201 })
}
