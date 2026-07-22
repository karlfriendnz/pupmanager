import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
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
  welcomeSubject: z.string().optional().nullable(),
  welcomeIntro: z.string().optional().nullable(),
  welcomeShowDiaryButton: z.boolean().default(true),
  welcomeButtonLabel: z.string().optional().nullable(),
  autoReplyMode: z.enum(['OFF', 'TEMPLATE', 'CUSTOM']).default('OFF'),
  autoReplyTemplateId: z.string().optional().nullable(),
  autoReplySubject: z.string().optional().nullable(),
  autoReplyBody: z.string().optional().nullable(),
})

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainer = await prisma.trainerProfile.findUnique({ where: { id: session.user.trainerId ?? '' }, select: { id: true } })
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
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainer = await prisma.trainerProfile.findUnique({ where: { id: session.user.trainerId ?? '' }, select: { id: true } })
  if (!trainer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Tenant check: an auto-reply template id from the request must belong to
  // this trainer, never another tenant's.
  if (parsed.data.autoReplyTemplateId) {
    const owned = await prisma.emailTemplate.findFirst({
      where: { id: parsed.data.autoReplyTemplateId, trainerId: trainer.id },
      select: { id: true },
    })
    if (!owned) return NextResponse.json({ error: 'Unknown template' }, { status: 400 })
  }

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
        welcomeSubject: parsed.data.welcomeSubject ?? null,
        welcomeIntro: parsed.data.welcomeIntro ?? null,
        welcomeShowDiaryButton: parsed.data.welcomeShowDiaryButton,
        welcomeButtonLabel: parsed.data.welcomeButtonLabel ?? null,
        autoReplyMode: parsed.data.autoReplyMode,
        autoReplyTemplateId: parsed.data.autoReplyTemplateId ?? null,
        autoReplySubject: parsed.data.autoReplySubject ?? null,
        autoReplyBody: parsed.data.autoReplyBody ?? null,
      },
    })
    return NextResponse.json(form, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[embed-forms POST]', msg)
    return NextResponse.json({ error: 'Database error', detail: msg }, { status: 500 })
  }
}
