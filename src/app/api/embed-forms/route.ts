import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const fieldSchema = z.object({
  key: z.enum(['phone', 'message']),
  required: z.boolean(),
})

const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}){1,2}([0-9a-fA-F]{2})?$/)

const schema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  fields: z.array(fieldSchema).default([]),
  customFieldIds: z.array(z.string()).default([]),
  thankYouTitle: z.string().optional().nullable(),
  thankYouMessage: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  showBorder: z.boolean().default(true),
  buttonColor: hexColor.nullable().optional(),
})

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainer = await prisma.trainerProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } })
  if (!trainer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const forms = await prisma.embedForm.findMany({
      where: { trainerId: trainer.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(forms)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[embed-forms GET]', msg)
    return NextResponse.json({ error: 'Database error', detail: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainer = await prisma.trainerProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } })
  if (!trainer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  try {
    const form = await prisma.embedForm.create({
      data: {
        trainerId: trainer.id,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        fields: parsed.data.fields,
        customFieldIds: parsed.data.customFieldIds,
        thankYouTitle: parsed.data.thankYouTitle ?? null,
        thankYouMessage: parsed.data.thankYouMessage ?? null,
        isActive: parsed.data.isActive,
        showBorder: parsed.data.showBorder,
        buttonColor: parsed.data.buttonColor ?? null,
      },
    })
    return NextResponse.json(form, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[embed-forms POST]', msg)
    return NextResponse.json({ error: 'Database error', detail: msg }, { status: 500 })
  }
}
