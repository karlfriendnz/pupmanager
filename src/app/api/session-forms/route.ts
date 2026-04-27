import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const baseQuestion = {
  id: z.string().min(1),
  required: z.boolean().default(false),
}

// CUSTOM_FIELD questions inherit label/type/options from the linked CustomField,
// so they don't carry their own label.
export const questionSchema = z.discriminatedUnion('type', [
  z.object({ ...baseQuestion, type: z.literal('SHORT_TEXT'), label: z.string().min(1) }),
  z.object({ ...baseQuestion, type: z.literal('LONG_TEXT'), label: z.string().min(1) }),
  z.object({ ...baseQuestion, type: z.literal('NUMBER'), label: z.string().min(1) }),
  z.object({ ...baseQuestion, type: z.literal('RATING_1_5'), label: z.string().min(1) }),
  z.object({ ...baseQuestion, type: z.literal('CUSTOM_FIELD'), customFieldId: z.string().min(1) }),
])

const formSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  introText: z.string().nullable().optional(),
  closingText: z.string().nullable().optional(),
  questions: z.array(questionSchema).min(1).max(50),
})

// Make sure every CUSTOM_FIELD question references a CustomField the trainer
// owns. Without this check, a malicious client could attach another trainer's
// fields and read/write those values.
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

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const forms = await prisma.sessionForm.findMany({
    where: { trainerId },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    include: { _count: { select: { responses: true } } },
  })
  return NextResponse.json(forms)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = formSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const ownership = await ensureLinkedFieldsOwned(parsed.data.questions, trainerId)
  if (!ownership.ok) {
    return NextResponse.json({ error: 'Linked fields not found', missing: ownership.missing }, { status: 400 })
  }

  const max = await prisma.sessionForm.aggregate({
    where: { trainerId },
    _max: { order: true },
  })
  const nextOrder = (max._max.order ?? -1) + 1

  const form = await prisma.sessionForm.create({
    data: {
      trainerId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      introText: parsed.data.introText ?? null,
      closingText: parsed.data.closingText ?? null,
      questions: parsed.data.questions,
      order: nextOrder,
    },
  })
  return NextResponse.json(form, { status: 201 })
}
