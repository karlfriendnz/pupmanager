import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { duplicateForm, type Question } from '@/lib/session-form-builder'
import { uniqueFormSlug } from '@/lib/form-api'

// POST /api/forms/[formId]/duplicate — clone a form: fresh question ids with
// the conditional logic rewired to point within the copy, a "Copy of …" name,
// its own slug, and draft state so it can't go live by accident.
export async function POST(_req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  const { formId } = await params

  const src = await prisma.form.findFirst({ where: { id: formId, trainerId } })
  if (!src) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const questions = duplicateForm(
    (Array.isArray(src.questions) ? src.questions : []) as unknown as Question[],
  )
  const name = `Copy of ${src.name}`
  const slug = src.usableAsEnquiry ? await uniqueFormSlug(trainerId, name) : null

  const copy = await prisma.form.create({
    data: {
      trainerId,
      name,
      description: src.description,
      usableAsIntake: src.usableAsIntake,
      usableAsEnquiry: src.usableAsEnquiry,
      slug,
      questions: questions as unknown as object[],
      steps: (src.steps ?? []) as unknown as object[],
      thankYouTitle: src.thankYouTitle,
      thankYouMessage: src.thankYouMessage,
      showBorder: src.showBorder,
      buttonColor: src.buttonColor,
      inviteSubject: src.inviteSubject,
      inviteBody: src.inviteBody,
      inviteShowDiaryButton: src.inviteShowDiaryButton,
      inviteButtonLabel: src.inviteButtonLabel,
      isActive: false, // duplicates start as drafts
    },
  })
  return NextResponse.json(copy, { status: 201 })
}
