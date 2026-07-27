import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import type { Question } from '@/lib/session-form-builder'

const schema = z.object({
  formId: z.string().min(1),
  // question id → string | string[]
  answers: z.record(z.string(), z.union([z.string().max(4000), z.array(z.string().max(2000)).max(50)])),
})

// POST /api/my/intake-form/submit — a client completes the client form their
// trainer assigned them. Saves the answers, stamps intakeCompletedAt (which is
// what lifts the gate in the client layout), and mirrors linked-field answers
// into CustomFieldValue.
export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'CLIENT') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const active = await getActiveClient()
  const clientProfile = active
    ? await prisma.clientProfile.findUnique({
        where: { id: active.clientId },
        select: { id: true, trainerId: true, intakeFormId: true },
      })
    : null
  if (!clientProfile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { formId, answers } = parsed.data

  // Only the client's OWN assigned form can be submitted here — otherwise any
  // client could post another trainer's form id and stamp themselves complete.
  if (clientProfile.intakeFormId !== formId) {
    return NextResponse.json({ error: 'This is not the form you were sent.' }, { status: 403 })
  }
  const form = await prisma.form.findFirst({
    where: { id: formId, trainerId: clientProfile.trainerId },
    select: { questions: true },
  })
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  const questions = (Array.isArray(form.questions) ? form.questions : []) as unknown as Question[]

  // Mirror linked-field answers into CustomFieldValue so the rest of the app
  // (client profile, reports, exports) reads them the usual way rather than
  // having to know about intakeAnswers. Sequential on purpose: a wide form run
  // in parallel exhausts the pooled connection limit.
  const linked = questions.filter(
    (q): q is Extract<Question, { type: 'CUSTOM_FIELD' }> => q.type === 'CUSTOM_FIELD',
  )
  const ownedFieldIds = new Set(
    linked.length
      ? (await prisma.customField.findMany({
          where: { trainerId: clientProfile.trainerId, id: { in: linked.map(q => q.customFieldId) } },
          select: { id: true },
        })).map(f => f.id)
      : [],
  )
  for (const q of linked) {
    if (!ownedFieldIds.has(q.customFieldId)) continue
    const raw = answers[q.id]
    const value = Array.isArray(raw) ? raw.join(', ') : (raw ?? '')
    if (!value.trim()) continue
    const existing = await prisma.customFieldValue.findFirst({
      where: { fieldId: q.customFieldId, clientId: clientProfile.id, dogId: null },
    })
    if (existing) {
      await prisma.customFieldValue.update({ where: { id: existing.id }, data: { value } })
    } else {
      await prisma.customFieldValue.create({
        data: { fieldId: q.customFieldId, clientId: clientProfile.id, value },
      })
    }
  }

  await prisma.clientProfile.update({
    where: { id: clientProfile.id },
    data: { intakeAnswers: answers as unknown as object, intakeCompletedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
