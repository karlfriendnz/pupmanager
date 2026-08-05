import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

// POST /api/forms/from-fields — turn the old field library into a real intake form.
//
// Karl, 2026-08-06, looking at "Your fields · 18 fields · Draft" sitting in the
// forms list: "that should be an intake form".
//
// He is right, and the reason it wasn't is historical: a trainer's questions used
// to live in TWO models. `CustomField` rows were both the columns on a client's
// record AND — via the fallback IntakeGate — the questions a new client answered.
// `Form` came later and does the asking properly: pages, conditional questions,
// a preview, an invite email.
//
// So this does NOT copy the fields, and deliberately does not touch them. A field
// is a column on the client record — the profile, the clients list, reports,
// exports and email merge tags all read it, in some seventy files. What was wrong
// was presenting that library AS a form.
//
// Each question is stored as a bare `customFieldId` link, which is the whole
// point: the answers keep landing on exactly the same field they always did, so
// nothing already collected moves and nothing is asked twice. The conversion is
// lossless in both directions — delete the form and the fields are untouched.
export async function POST() {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId

  const fields = await prisma.customField.findMany({
    where: { trainerId },
    orderBy: { order: 'asc' },
    select: { id: true, required: true, appliesTo: true },
  })
  if (fields.length === 0) {
    return NextResponse.json(
      { error: 'There are no fields to turn into a form yet.' },
      { status: 400 },
    )
  }

  // The old gate asked about the owner first, then the dog. Keep that reading
  // order as real pages, and skip the dog page when nothing applies to a dog —
  // an empty step is a page a client taps Next through for no reason.
  const ownerFields = fields.filter(f => f.appliesTo !== 'DOG')
  const dogFields = fields.filter(f => f.appliesTo === 'DOG')
  const steps = [
    ...(ownerFields.length ? [{ id: 'owner', title: 'About you' }] : []),
    ...(dogFields.length ? [{ id: 'dog', title: 'About your dog' }] : []),
  ]
  // One page is not a wizard — store no steps at all so it renders as a plain form.
  const useSteps = steps.length > 1

  const questions = [...ownerFields, ...dogFields].map(f => ({
    id: `q_${f.id}`,
    type: 'CUSTOM_FIELD' as const,
    customFieldId: f.id,
    required: f.required,
    ...(useSteps && { step: f.appliesTo === 'DOG' ? 'dog' : 'owner' }),
  }))

  // A draft, not published. This makes a form out of what a trainer already had;
  // whether new clients are then asked it is their call, made on the form itself.
  const form = await prisma.form.create({
    data: {
      trainerId,
      name: 'New client',
      description:
        '<p>A few things before we start, so the first session is about your dog and not about paperwork.</p>',
      usableAsIntake: true,
      usableAsEnquiry: false,
      questions,
      steps: useSteps ? steps : [],
      isActive: false,
    },
    select: { id: true },
  })

  return NextResponse.json({ id: form.id, questionCount: questions.length }, { status: 201 })
}
