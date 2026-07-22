import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
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
  welcomeSubject: z.string().optional().nullable(),
  welcomeIntro: z.string().optional().nullable(),
  welcomeShowDiaryButton: z.boolean().optional(),
  welcomeButtonLabel: z.string().optional().nullable(),
  autoReplyMode: z.enum(['OFF', 'TEMPLATE', 'CUSTOM']).optional(),
  autoReplyTemplateId: z.string().optional().nullable(),
  autoReplySubject: z.string().optional().nullable(),
  autoReplyBody: z.string().optional().nullable(),
})

async function getForm(formId: string, userId: string) {
  const trainer = await prisma.trainerProfile.findUnique({ where: { userId }, select: { id: true } })
  if (!trainer) return null
  return prisma.embedForm.findFirst({ where: { id: formId, trainerId: trainer.id } })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { formId } = await params
  const form = await getForm(formId, session.user.id)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // The auto-reply template must belong to THIS trainer — never trust an id
  // from the request, or one tenant could make their form send another
  // tenant's email copy.
  if (parsed.data.autoReplyTemplateId) {
    const owned = await prisma.emailTemplate.findFirst({
      where: { id: parsed.data.autoReplyTemplateId, trainerId: form.trainerId },
      select: { id: true },
    })
    if (!owned) return NextResponse.json({ error: 'Unknown template' }, { status: 400 })
  }

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
      ...(parsed.data.welcomeSubject !== undefined && { welcomeSubject: parsed.data.welcomeSubject }),
      ...(parsed.data.welcomeIntro !== undefined && { welcomeIntro: parsed.data.welcomeIntro }),
      ...(parsed.data.welcomeShowDiaryButton !== undefined && { welcomeShowDiaryButton: parsed.data.welcomeShowDiaryButton }),
      ...(parsed.data.welcomeButtonLabel !== undefined && { welcomeButtonLabel: parsed.data.welcomeButtonLabel }),
      ...(parsed.data.autoReplyMode !== undefined && { autoReplyMode: parsed.data.autoReplyMode }),
      ...(parsed.data.autoReplyTemplateId !== undefined && { autoReplyTemplateId: parsed.data.autoReplyTemplateId }),
      ...(parsed.data.autoReplySubject !== undefined && { autoReplySubject: parsed.data.autoReplySubject }),
      ...(parsed.data.autoReplyBody !== undefined && { autoReplyBody: parsed.data.autoReplyBody }),
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { formId } = await params
  const form = await getForm(formId, session.user.id)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.embedForm.delete({ where: { id: formId } })
  return NextResponse.json({ ok: true })
}
