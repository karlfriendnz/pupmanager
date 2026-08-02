import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext, type TrainerContext } from '@/lib/membership'
import { accessibleSessionWhere } from '@/lib/session-access'
import { releaseRecaps } from '@/lib/recap-notify'
import { isSessionDone, isReportVisibleToClient } from '@/lib/report-visibility'
import { z } from 'zod'

const upsertSchema = z.object({
  // Question id → answer (string).
  answers: z.record(z.string(), z.string()),
  // Question id → list of image URLs. Optional; absent means "leave as-is".
  imagesByQuestion: z.record(z.string(), z.array(z.string().url())).optional(),
  // Per-session top/bottom messages. Empty string clears.
  introMessage: z.string().nullable().optional(),
  closingMessage: z.string().nullable().optional(),
})

interface CustomFieldQuestion {
  id: string
  type: 'CUSTOM_FIELD'
  customFieldId: string
}

interface BasicQuestion {
  id: string
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5'
  label: string
  required?: boolean
}

type Question = CustomFieldQuestion | BasicQuestion

async function ownership(sessionId: string, formId: string, ctx: TrainerContext) {
  const session = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId: ctx.companyId, ...accessibleSessionWhere(ctx) },
    select: { id: true, status: true, clientId: true, dogId: true, client: { select: { dogId: true } } },
  })
  const form = await prisma.sessionForm.findFirst({
    where: { id: formId, trainerId: ctx.companyId },
    select: { id: true, questions: true },
  })
  if (!session || !form) return null
  return { session, form }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ sessionId: string; formId: string }> }
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = ctx.companyId

  const { sessionId, formId } = await params
  const owned = await ownership(sessionId, formId, ctx)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = upsertSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Resolve which CUSTOM_FIELD answers we should write through to the client's
  // CustomFieldValue table. We need:
  //   1. The session's client (target) and dog (for DOG-scoped fields).
  //   2. The form's question definitions to find which answers are linked.
  //   3. Each linked CustomField's metadata to know if it's OWNER or DOG.
  const questions: Question[] = Array.isArray(owned.form.questions)
    ? (owned.form.questions as unknown as Question[])
    : []
  const customFieldQuestions = questions.filter(
    (q): q is CustomFieldQuestion => q.type === 'CUSTOM_FIELD'
  )
  const clientId = owned.session.clientId
  const resolvedDogId = owned.session.dogId ?? owned.session.client?.dogId ?? null

  // If there are linked questions but no client on this session, we can save
  // the response snapshot but cannot write through to the client record. Soft-
  // skip rather than failing — the trainer can still capture the report.
  let linkedFieldDefs: { id: string; appliesTo: string }[] = []
  if (customFieldQuestions.length > 0) {
    linkedFieldDefs = await prisma.customField.findMany({
      where: {
        trainerId,
        id: { in: customFieldQuestions.map(q => q.customFieldId) },
      },
      select: { id: true, appliesTo: true },
    })
  }
  const fieldMeta = new Map(linkedFieldDefs.map(f => [f.id, f.appliesTo ?? 'OWNER']))

  const imagesByQuestion = parsed.data.imagesByQuestion ?? {}
  const introMessage = parsed.data.introMessage ?? null
  const closingMessage = parsed.data.closingMessage ?? null

  // Saving a note on a session that is NOT yet complete writes a draft: the
  // client sees nothing, and the trainer can keep working on it. Saving one on a
  // session that IS complete publishes it (see the release below).
  //
  // That second case is the whole reason completion alone isn't enough. A
  // trainer who sits down on Sunday to write up Thursday's session has already
  // marked it complete — if only the status transition published, they would
  // have to un-complete and re-complete to let the client read what they just
  // wrote, which is a worse ritual than the Send button we removed.
  await prisma.$transaction(async (tx) => {
    await tx.sessionFormResponse.upsert({
      where: { sessionId_formId: { sessionId, formId } },
      create: {
        sessionId, formId,
        answers: parsed.data.answers,
        imagesByQuestion,
        introMessage,
        closingMessage,
      },
      update: {
        answers: parsed.data.answers,
        imagesByQuestion,
        introMessage,
        closingMessage,
      },
    })

    // Write CUSTOM_FIELD answers through to the client's record so they show
    // up in the client's profile too. DOG-scoped fields need a resolved dog id.
    if (clientId) {
      for (const q of customFieldQuestions) {
        const answer = parsed.data.answers[q.id]
        if (answer === undefined) continue
        const appliesTo = fieldMeta.get(q.customFieldId) ?? 'OWNER'
        const isDog = appliesTo === 'DOG'
        if (isDog && !resolvedDogId) continue   // can't write a dog field without a dog
        const targetDogId = isDog ? resolvedDogId : null

        // Empty string means "clear" — delete the existing value rather than
        // storing a blank.
        if (answer === '') {
          await tx.customFieldValue.deleteMany({
            where: { fieldId: q.customFieldId, clientId, dogId: targetDogId },
          })
          continue
        }

        // No composite unique on CustomFieldValue, so delete-then-create keeps
        // a single row per (field, client, dog).
        await tx.customFieldValue.deleteMany({
          where: { fieldId: q.customFieldId, clientId, dogId: targetDogId },
        })
        await tx.customFieldValue.create({
          data: { fieldId: q.customFieldId, clientId, dogId: targetDogId, value: answer },
        })
      }
    }
  })

  // The session is already ticked off, so this write-up is published the moment
  // it is saved — and the client is told, once. releaseRecaps skips anything
  // already announced, so editing a typo in a note that has gone out does not
  // ping the client again.
  if (isSessionDone(owned.session.status)) {
    try {
      await releaseRecaps({ trainerId, sessionIds: [sessionId] })
    } catch {
      // A notification failure must not lose the trainer's write-up.
    }
  }

  // Re-read so the client gets the fresh response (including auto-updated timestamps).
  const response = await prisma.sessionFormResponse.findUnique({
    where: { sessionId_formId: { sessionId, formId } },
  })

  return NextResponse.json(
    response && {
      ...response,
      // What the trainer's screen needs to tell the truth about who can read
      // this. Computed here because only the server knows the session's status.
      visibleToClient: isReportVisibleToClient(response, owned.session.status),
    },
  )
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string; formId: string }> }
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId, formId } = await params
  const owned = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId: ctx.companyId, ...accessibleSessionWhere(ctx) },
    select: { id: true },
  })
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { count } = await prisma.sessionFormResponse.deleteMany({
    where: { sessionId, formId },
  })
  if (count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
