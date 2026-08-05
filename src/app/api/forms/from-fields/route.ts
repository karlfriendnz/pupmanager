import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { buildIntakeFormFromFields } from '@/lib/form-api'

// POST /api/forms/from-fields — turn the old field library into a real intake form.
//
// Karl, 2026-08-06, looking at "Your fields · 18 fields · Draft" sitting in the
// forms list: "that should be an intake form".
//
// This does NOT copy the fields and deliberately does not touch them. A field is
// a column on the client record — the profile, the clients list, reports, exports
// and email merge tags all read it, in some seventy files. What was wrong was
// presenting that library AS a form.
//
// The question shapes (and which page each lands on) live in
// buildIntakeFormFromFields, so they can be tested without a database.
export async function POST() {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId

  // Scoped to this trainer, so the form can only ever be built from their own
  // fields — the ids never come from the browser at all.
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

  const { questions, steps } = buildIntakeFormFromFields(fields)

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
      steps,
      isActive: false,
    },
    select: { id: true },
  })

  return NextResponse.json({ id: form.id, questionCount: questions.length }, { status: 201 })
}
