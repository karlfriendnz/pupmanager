import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { formSchema, persistLinkedFields, uniqueFormSlug, slugify } from '@/lib/form-api'

// GET /api/forms — the trainer's unified forms. Read-only, so any team member
// may list them (the invite screen's intake-form picker needs this); creating
// and editing are gated on settings.edit below.
export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const forms = await prisma.form.findMany({
    where: { trainerId: session.user.trainerId },
    orderBy: [{ createdAt: 'asc' }],
  })
  return NextResponse.json(forms)
}

// POST /api/forms — create a form.
export async function POST(req: Request) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId

  const parsed = formSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const data = parsed.data

  // Writes any field the builder authored and hands the questions back as bare
  // links, so the CustomField stays the one definition of what a field is.
  const linked = await persistLinkedFields(data.questions, trainerId)
  if (!linked.ok) {
    return NextResponse.json({ error: 'Unknown linked field', missing: linked.missing }, { status: 400 })
  }
  const questions = linked.questions

  // Only enquiry forms carry a public slug; keep it unique per trainer.
  const slug = data.usableAsEnquiry
    ? await uniqueFormSlug(trainerId, data.slug?.trim() || slugify(data.name))
    : null

  const form = await prisma.form.create({
    data: {
      trainerId,
      name: data.name.trim(),
      description: data.description ?? null,
      usableAsIntake: data.usableAsIntake,
      usableAsEnquiry: data.usableAsEnquiry,
      slug,
      questions: questions as unknown as object[],
      steps: (data.steps ?? []) as unknown as object[],
      thankYouTitle: data.thankYouTitle ?? null,
      thankYouMessage: data.thankYouMessage ?? null,
      showBorder: data.showBorder ?? true,
      buttonColor: data.buttonColor || null,
      inviteSubject: data.inviteSubject ?? null,
      inviteBody: data.inviteBody ?? null,
      inviteShowDiaryButton: data.inviteShowDiaryButton ?? true,
      inviteButtonLabel: data.inviteButtonLabel ?? null,
      isActive: data.isActive ?? true,
    },
  })
  return NextResponse.json(form, { status: 201 })
}
