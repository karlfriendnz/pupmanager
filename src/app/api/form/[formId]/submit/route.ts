import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { clientFieldLabel } from '@/lib/client-fields'
import { z } from 'zod'
import { notifyEnquiryTrainer } from '@/lib/notify-enquiry-trainer'
import { sendFormAutoReply } from '@/lib/form-auto-reply'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { isQuestionVisible, type Question } from '@/lib/session-form-builder'
import { continuationPath, mintContinuationToken } from '@/lib/form-continuation'
import { sendContinuationEmail } from '@/lib/form-continuation-email'

// Length caps matter here because this is an UNAUTHENTICATED public endpoint —
// without them a submitter can post megabyte strings and bloat the DB.
const schema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(40).optional().nullable(),
  message: z.string().max(4000).optional().nullable(),
  customFields: z.record(z.string(), z.string().max(2000)).optional(),
})

// A unified Form's enquiry submission: the fixed contact block, plus free-form
// answers keyed by question id (a string, or a string[] for checkboxes). Same
// reasoning on the caps — this endpoint is unauthenticated.
const unifiedSchema = z.object({
  contact: z.object({
    name: z.string().min(1).max(120),
    email: z.string().email().max(200),
    phone: z.string().max(40).optional().nullable(),
  }),
  answers: z.record(z.string(), z.union([z.string().max(2000), z.array(z.string().max(2000)).max(50)])),
})

// Public form submission. Creates an Enquiry in NEW state — the trainer
// reviews it and then Accepts (creates the User + ClientProfile + Dog) or
// Declines. We deliberately don't create any account here so spam and
// drive-by submissions don't pollute the user table.
export async function POST(req: Request, { params }: { params: Promise<{ formId: string }> }) {
  // Unauthenticated endpoint that creates a row + emails/pushes the trainer —
  // cap submissions per IP to stop spam/notification flooding.
  const limited = await enforceRateLimit({ key: `form-submit:${getClientIp(req)}`, limit: 10, windowMs: 10 * 60_000 })
  if (limited) return limited

  const { formId } = await params

  const form = await prisma.embedForm.findFirst({
    where: { id: formId, isActive: true },
    select: { id: true, trainerId: true, customFieldIds: true },
  })
  // No legacy EmbedForm under this id → it may be a unified Form published as
  // an enquiry form. Same public URL, same rate limit, same Enquiry out.
  if (!form) return submitUnified(req, formId)

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { name, email, phone, message, customFields } = parsed.data

  const enabledCustomFieldIds = Array.isArray(form.customFieldIds) ? form.customFieldIds as string[] : []
  if (enabledCustomFieldIds.length > 0) {
    const requiredFields = await prisma.customField.findMany({
      where: { id: { in: enabledCustomFieldIds }, required: true },
    })
    for (const field of requiredFields) {
      if (!customFields?.[field.id]?.trim()) {
        return NextResponse.json({ error: `${field.label} is required.` }, { status: 400 })
      }
    }
  }

  // Snapshot only the answers for fields actually enabled on this form, so a
  // later edit to the trainer's custom-field config doesn't surface stray
  // values when the enquiry is reopened.
  const customFieldSnapshot: Record<string, string> = {}
  if (customFields) {
    for (const [fieldId, value] of Object.entries(customFields)) {
      if (enabledCustomFieldIds.includes(fieldId) && value?.trim()) {
        customFieldSnapshot[fieldId] = value.trim()
      }
    }
  }

  const enquiry = await prisma.enquiry.create({
    data: {
      trainerId: form.trainerId,
      formId: form.id,
      name,
      email,
      phone: phone?.trim() || null,
      message: message?.trim() || null,
      customFieldValues: customFieldSnapshot,
    },
    select: { id: true },
  })

  // Fire-and-forget push + email to the trainer. The helper fetches
  // the full enquiry on its own and swallows errors internally so a
  // flaky APNs/Resend round-trip never fails the public form.
  await notifyEnquiryTrainer({ enquiryId: enquiry.id })

  // …and the auto-reply to the person who just filled it in, so they get an
  // immediate acknowledgement instead of silence until the trainer accepts.
  // No-ops unless this form has an auto-reply configured. Also swallows its
  // own errors — a failed courtesy email must never fail the submission.
  await sendFormAutoReply(enquiry.id)

  return NextResponse.json({ ok: true }, { status: 201 })
}

// A unified Form's public enquiry submit.
//
// Two answer buckets are stored, deliberately:
//   customFieldValues — ONLY the linked (CUSTOM_FIELD) answers, keyed by the
//     real customFieldId. acceptEnquiry turns these into CustomFieldValue
//     rows, so keeping free-form answers out of here is what stops an accept
//     from blowing up on a foreign-key violation.
//   formAnswers — the FULL question-id → answer snapshot, for the trainer to
//     read on the enquiry detail.
async function submitUnified(req: Request, id: string) {
  const form = await prisma.form.findFirst({
    where: { id, isActive: true, usableAsEnquiry: true },
    select: { id: true, trainerId: true, questions: true, continueToAccount: true },
  })
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  const parsed = unifiedSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { contact, answers } = parsed.data

  const questions = (Array.isArray(form.questions) ? form.questions : []) as unknown as Question[]

  // Required-field validation, respecting conditional visibility — a required
  // question the answers never revealed was never asked, so it can't block the
  // submission. Re-checked here and not just in the browser: this is a public
  // endpoint and anyone can POST to it directly.
  for (const q of questions) {
    if (!q.required || !isQuestionVisible(q, answers)) continue
    const v = answers[q.id]
    const filled = Array.isArray(v) ? v.length > 0 : !!(v && v.trim())
    if (!filled) {
      const label = q.type === 'CUSTOM_FIELD'
        ? 'A required field'
        : q.type === 'CLIENT_FIELD'
          ? clientFieldLabel(q.fieldKey)
          : q.label
      return NextResponse.json({ error: `${label} is required.` }, { status: 400 })
    }
  }

  // Snapshot linked answers, but only to fields this form's trainer owns — a
  // question referencing someone else's field id must not write into it.
  // A SAVED question always carries its id — the server writes the field and
  // normalises the link before storing — so a linked question without one is a
  // stale row, not something to write into.
  const linked = questions.filter(
    (q): q is Extract<Question, { type: 'CUSTOM_FIELD' }> & { customFieldId: string } =>
      q.type === 'CUSTOM_FIELD' && !!q.customFieldId,
  )
  const ownedIds = new Set(
    linked.length
      ? (await prisma.customField.findMany({
          where: { trainerId: form.trainerId, id: { in: linked.map(q => q.customFieldId) } },
          select: { id: true },
        })).map(f => f.id)
      : [],
  )
  const customFieldSnapshot: Record<string, string> = {}
  for (const q of linked) {
    if (!ownedIds.has(q.customFieldId)) continue
    const raw = answers[q.id]
    const value = Array.isArray(raw) ? raw.join(', ') : (raw ?? '')
    if (value.trim()) customFieldSnapshot[q.customFieldId] = value.trim()
  }

  // The first long-text answer becomes `message`, so the enquiry list shows a
  // preview line without the trainer having to open the full answer set.
  const firstLong = questions.find(q => q.type === 'LONG_TEXT')
  const message =
    firstLong && typeof answers[firstLong.id] === 'string'
      ? (answers[firstLong.id] as string).trim() || null
      : null

  // ── The handover, when this form is a continuous run ──────────────────────
  //
  // The ENQUIRY IS STILL WRITTEN, exactly as before, and it is written FIRST.
  // Someone who abandons the password step therefore leaves their trainer a
  // name, an email and a phone number to reply to by hand — an enquiry with no
  // way to reply is worse than no enquiry, and that is the failure mode a
  // "sign up first" ordering would have created.
  const handover = form.continueToAccount ? mintContinuationToken() : null

  const enquiry = await prisma.enquiry.create({
    data: {
      trainerId: form.trainerId,
      unifiedFormId: form.id,
      name: contact.name.trim(),
      email: contact.email.trim(),
      phone: contact.phone?.trim() || null,
      message,
      customFieldValues: customFieldSnapshot,
      formAnswers: answers as unknown as object,
      ...(handover && {
        continuationTokenHash: handover.hash,
        continuationExpiresAt: handover.expires,
      }),
    },
    select: { id: true },
  })

  await notifyEnquiryTrainer({ enquiryId: enquiry.id })

  if (handover) {
    // The same link by email, so a closed tab isn't the end of the run. Fire
    // and forget: a flaky Resend round-trip must never fail a submission, and
    // the person is normally already on the next screen before it lands.
    sendContinuationEmail({ enquiryId: enquiry.id, plainToken: handover.plain }).catch(err => {
      console.error('[form-submit] continuation email failed:', err)
    })
    return NextResponse.json(
      { ok: true, continueUrl: continuationPath(form.id, handover.plain) },
      { status: 201 },
    )
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
