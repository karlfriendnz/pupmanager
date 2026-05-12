import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const fieldSchema = z.object({
  key: z.enum(['phone', 'message']),
  required: z.boolean(),
})

// 7-char (#rgb) or 9-char (#rrggbbaa) hex colour. Loose regex —
// browser <input type="color"> always emits #rrggbb, so this is mostly
// defensive against direct API consumers passing odd strings.
const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}){1,2}([0-9a-fA-F]{2})?$/)

const schema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  fields: z.array(fieldSchema).optional(),
  customFieldIds: z.array(z.string()).optional(),
  thankYouTitle: z.string().optional().nullable(),
  thankYouMessage: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  showBorder: z.boolean().optional(),
  buttonColor: hexColor.nullable().optional(),
})

async function getForm(formId: string, userId: string) {
  const trainer = await prisma.trainerProfile.findUnique({ where: { userId }, select: { id: true } })
  if (!trainer) return null
  return prisma.embedForm.findFirst({ where: { id: formId, trainerId: trainer.id } })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { formId } = await params
  const form = await getForm(formId, session.user.id)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const updated = await prisma.embedForm.update({
    where: { id: formId },
    data: {
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      ...(parsed.data.fields !== undefined && { fields: parsed.data.fields }),
      ...(parsed.data.customFieldIds !== undefined && { customFieldIds: parsed.data.customFieldIds }),
      ...(parsed.data.thankYouTitle !== undefined && { thankYouTitle: parsed.data.thankYouTitle }),
      ...(parsed.data.thankYouMessage !== undefined && { thankYouMessage: parsed.data.thankYouMessage }),
      ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
      ...(parsed.data.showBorder !== undefined && { showBorder: parsed.data.showBorder }),
      ...(parsed.data.buttonColor !== undefined && { buttonColor: parsed.data.buttonColor }),
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { formId } = await params
  const form = await getForm(formId, session.user.id)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.embedForm.delete({ where: { id: formId } })
  return NextResponse.json({ ok: true })
}
