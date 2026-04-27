import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const baseQuestion = {
  id: z.string().min(1),
  required: z.boolean().default(false),
}

const questionSchema = z.discriminatedUnion('type', [
  z.object({ ...baseQuestion, type: z.literal('SHORT_TEXT'), label: z.string().min(1) }),
  z.object({ ...baseQuestion, type: z.literal('LONG_TEXT'), label: z.string().min(1) }),
  z.object({ ...baseQuestion, type: z.literal('NUMBER'), label: z.string().min(1) }),
  z.object({ ...baseQuestion, type: z.literal('RATING_1_5'), label: z.string().min(1) }),
  z.object({ ...baseQuestion, type: z.literal('CUSTOM_FIELD'), customFieldId: z.string().min(1) }),
])

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  introText: z.string().nullable().optional(),
  closingText: z.string().nullable().optional(),
  questions: z.array(questionSchema).min(1).max(50).optional(),
})

async function ownForm(formId: string, trainerId: string) {
  return prisma.sessionForm.findFirst({ where: { id: formId, trainerId } })
}

async function ensureLinkedFieldsOwned(
  questions: z.infer<typeof questionSchema>[],
  trainerId: string,
): Promise<{ ok: true } | { ok: false; missing: string[] }> {
  const linkedIds = questions
    .filter(q => q.type === 'CUSTOM_FIELD')
    .map(q => (q as { customFieldId: string }).customFieldId)
  if (linkedIds.length === 0) return { ok: true }
  const owned = await prisma.customField.findMany({
    where: { trainerId, id: { in: linkedIds } },
    select: { id: true },
  })
  const ownedSet = new Set(owned.map(f => f.id))
  const missing = linkedIds.filter(id => !ownedSet.has(id))
  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { formId } = await params
  if (!(await ownForm(formId, trainerId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  if (parsed.data.questions) {
    const ownership = await ensureLinkedFieldsOwned(parsed.data.questions, trainerId)
    if (!ownership.ok) {
      return NextResponse.json({ error: 'Linked fields not found', missing: ownership.missing }, { status: 400 })
    }
  }

  const form = await prisma.sessionForm.update({
    where: { id: formId },
    data: parsed.data,
  })
  return NextResponse.json(form)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { formId } = await params
  if (!(await ownForm(formId, trainerId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.sessionForm.delete({ where: { id: formId } })
  return NextResponse.json({ ok: true })
}
