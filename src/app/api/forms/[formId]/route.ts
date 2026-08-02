import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { formPatchSchema, persistLinkedFields, resolveContinuationIntakeForm, uniqueFormSlug } from '@/lib/form-api'

async function ownedForm(formId: string, trainerId: string) {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: { id: true, trainerId: true, name: true },
  })
  return form?.trainerId === trainerId ? form : null
}

export async function GET(_req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const { formId } = await params
  const form = await prisma.form.findFirst({ where: { id: formId, trainerId: session.user.trainerId } })
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(form)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  const { formId } = await params
  const existing = await ownedForm(formId, trainerId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = formPatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  // Writes any field the builder authored (creating new ones, editing linked
  // ones in place) and returns the questions as bare links.
  let questions = d.questions
  if (d.questions) {
    const linked = await persistLinkedFields(d.questions, trainerId)
    if (!linked.ok) {
      return NextResponse.json({ error: 'Unknown linked field', missing: linked.missing }, { status: 400 })
    }
    questions = linked.questions
  }

  // Keep the enquiry slug in sync: mint one when the form becomes an enquiry
  // form, clear it when it stops being one, and leave it alone otherwise (a
  // publish-toggle PATCH sends neither field).
  let slug: string | null | undefined
  if (d.usableAsEnquiry === true || (d.slug !== undefined && d.usableAsEnquiry !== false)) {
    slug = await uniqueFormSlug(trainerId, d.slug?.trim() || d.name || existing.name, formId)
  } else if (d.usableAsEnquiry === false) {
    slug = null
  }

  // The handover target is re-read as one of THIS trainer's intake forms, never
  // taken on trust — an id from another business would render their questions
  // to a stranger who enquired here.
  const continueIntakeFormId = await resolveContinuationIntakeForm(
    d.continueIntakeFormId,
    trainerId,
    formId,
  )

  const form = await prisma.form.update({
    where: { id: formId },
    data: {
      ...(d.name !== undefined && { name: d.name.trim() }),
      ...(d.description !== undefined && { description: d.description }),
      ...(d.usableAsIntake !== undefined && { usableAsIntake: d.usableAsIntake }),
      ...(d.usableAsEnquiry !== undefined && { usableAsEnquiry: d.usableAsEnquiry }),
      ...(slug !== undefined && { slug }),
      ...(questions !== undefined && { questions: questions as unknown as object[] }),
      ...(d.steps !== undefined && { steps: d.steps as unknown as object[] }),
      ...(d.thankYouTitle !== undefined && { thankYouTitle: d.thankYouTitle }),
      ...(d.thankYouMessage !== undefined && { thankYouMessage: d.thankYouMessage }),
      ...(d.showBorder !== undefined && { showBorder: d.showBorder }),
      ...(d.buttonColor !== undefined && { buttonColor: d.buttonColor || null }),
      ...(d.inviteSubject !== undefined && { inviteSubject: d.inviteSubject }),
      ...(d.inviteBody !== undefined && { inviteBody: d.inviteBody }),
      ...(d.inviteShowDiaryButton !== undefined && { inviteShowDiaryButton: d.inviteShowDiaryButton }),
      ...(d.inviteButtonLabel !== undefined && { inviteButtonLabel: d.inviteButtonLabel }),
      ...(d.isActive !== undefined && { isActive: d.isActive }),
      ...(d.continueToAccount !== undefined && { continueToAccount: d.continueToAccount }),
      ...(continueIntakeFormId !== undefined && { continueIntakeFormId }),
    },
  })
  return NextResponse.json(form)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  const { formId } = await params
  if (!(await ownedForm(formId, trainerId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Clients assigned this form and enquiries created from it keep their rows —
  // both FKs are SetNull, so deleting a form never deletes a client's history.
  await prisma.form.delete({ where: { id: formId } })
  return NextResponse.json({ ok: true })
}
