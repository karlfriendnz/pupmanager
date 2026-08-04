import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { collectClientFieldWrites, hasClientFieldWrites } from '@/lib/client-field-writes'
import { missingRequiredQuestions, type Question } from '@/lib/session-form-builder'

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
        select: { id: true, trainerId: true, intakeFormId: true, intakeCompletedAt: true },
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
  // Once it's done it's done. The gate is the only screen that posts here and it
  // stops rendering the moment the intake completes — so a second submission is
  // a stale tab or a script, and letting it through would overwrite answers the
  // trainer is relying on with whatever it sent, including nothing at all.
  if (clientProfile.intakeCompletedAt) {
    return NextResponse.json({ error: 'You have already completed this form.' }, { status: 409 })
  }
  const form = await prisma.form.findFirst({
    where: { id: formId, trainerId: clientProfile.trainerId },
    select: { questions: true },
  })
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  const questions = (Array.isArray(form.questions) ? form.questions : []) as unknown as Question[]

  // Required means required on the server too. Enforcing it only in FormRunner
  // meant an empty post stamped intakeCompletedAt, lifted the gate, and told the
  // trainer their client had filled the form in.
  const missing = missingRequiredQuestions(questions, answers)
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: 'Please answer every required question.',
        missing: missing.map(q => q.id),
      },
      { status: 400 },
    )
  }

  // Mirror linked-field answers into CustomFieldValue so the rest of the app
  // (client profile, reports, exports) reads them the usual way rather than
  // having to know about intakeAnswers. Sequential on purpose: a wide form run
  // in parallel exhausts the pooled connection limit.
  // A SAVED question always carries its id — the server writes the field and
  // normalises the link before storing — so one without it is a stale row rather
  // than a field to mirror into.
  const linked = questions.filter(
    (q): q is Extract<Question, { type: 'CUSTOM_FIELD' }> & { customFieldId: string } =>
      q.type === 'CUSTOM_FIELD' && !!q.customFieldId,
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

  // Built-in details go to the columns they belong to. A name collected on an
  // intake form has to BE the client's name — leaving it in intakeAnswers means
  // the trainer's client list still says "Unnamed" after the client filled the
  // form in. Blank answers write nothing, so skipping an optional question can't
  // wipe a phone number the trainer already had.
  const writes = collectClientFieldWrites(questions, answers)
  if (hasClientFieldWrites(writes)) {
    const profile = await prisma.clientProfile.findUnique({
      where: { id: clientProfile.id },
      select: { userId: true, dogId: true },
    })
    if (Object.keys(writes.user).length > 0 && profile?.userId) {
      // Email is deliberately NOT written: it's the client's login, and letting a
      // form change it would lock them out of the account they just used.
      const { email: _ignored, ...safe } = writes.user
      if (Object.keys(safe).length > 0) {
        await prisma.user.update({ where: { id: profile.userId }, data: safe })
      }
    }
    if (Object.keys(writes.profile).length > 0) {
      await prisma.clientProfile.update({ where: { id: clientProfile.id }, data: writes.profile })
    }
    // Their primary dog, when they have one. Creating a dog from an intake answer
    // is a bigger decision than this route should take on its own.
    if (Object.keys(writes.dog).length > 0 && profile?.dogId) {
      await prisma.dog.update({ where: { id: profile.dogId }, data: writes.dog })
    }
  }

  await prisma.clientProfile.update({
    where: { id: clientProfile.id },
    data: { intakeAnswers: answers as unknown as object, intakeCompletedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
