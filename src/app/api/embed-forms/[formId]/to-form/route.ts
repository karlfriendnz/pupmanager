import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { buildEnquiryFormFromEmbed, uniqueFormSlug } from '@/lib/form-api'

// POST /api/embed-forms/[formId]/to-form — turn a legacy lead-capture form into
// a real website enquiry form.
//
// Karl, 2026-08-06, opening one: "this design is very very different to the
// other one … all forms should be the same right?"
//
// It is different because it is a different MODEL, not a different stylesheet.
// An EmbedForm has no questions — just two fixed toggles and a list of linked
// field ids, with no question types, no pages and no conditional logic. So the
// fix for "make them the same" is not to restyle a dead-end editor; it is to
// give the trainer the same form in the model that has all of that.
//
// THE EMBED FORM IS LEFT COMPLETELY UNTOUCHED. It is live on somebody's website
// behind an <iframe> that this route has no way to update, so deleting or
// disabling it here would take a working enquiry form off a trainer's site
// without warning. They swap the URL when they are ready; until then both work
// and both land in the same enquiries list.
export async function POST(_req: Request, { params }: { params: Promise<{ formId: string }> }) {
  // forms.manage, like every other route under /embed-forms — not the
  // settings.edit that /api/forms uses. Copying the neighbouring file's guard is
  // how a route quietly widens who can call it; permission-areas.test.ts caught
  // exactly that here.
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  const { formId } = await params

  // findFirst WITH trainerId, never findUnique on the id alone: the id comes off
  // a URL, and another trainer's form would otherwise be copied — questions,
  // linked fields and all — into this trainer's account.
  const embed = await prisma.embedForm.findFirst({
    where: { id: formId, trainerId },
  })
  if (!embed) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const embedFields = (Array.isArray(embed.fields) ? embed.fields : []) as { key: string; required: boolean }[]
  const linkedIds = (Array.isArray(embed.customFieldIds) ? embed.customFieldIds : []) as string[]

  // Re-check every linked id against this trainer's own fields. A stale id (the
  // field was deleted after the embed form was built) would otherwise become a
  // question that renders as a blank box nobody can answer.
  const ownFields = await prisma.customField.findMany({
    where: { trainerId, id: { in: linkedIds } },
    select: { id: true, required: true },
  })
  const owned = new Map(ownFields.map(f => [f.id, f.required]))
  const liveLinkedIds = linkedIds.filter(id => owned.has(id))

  const { questions, skipped } = buildEnquiryFormFromEmbed(
    embedFields,
    liveLinkedIds,
    Object.fromEntries(owned),
  )

  const form = await prisma.form.create({
    data: {
      trainerId,
      name: embed.title,
      description: embed.description,
      usableAsIntake: false,
      usableAsEnquiry: true,
      slug: await uniqueFormSlug(trainerId, embed.title),
      questions,
      steps: [],
      thankYouTitle: embed.thankYouTitle,
      thankYouMessage: embed.thankYouMessage,
      showBorder: embed.showBorder,
      buttonColor: embed.buttonColor,
      // A draft. The old form is still the live one on their site, so publishing
      // the new one is the moment they choose to switch — not a side effect of
      // pressing a button labelled "turn into".
      isActive: false,
    },
    select: { id: true },
  })

  return NextResponse.json(
    {
      id: form.id,
      questionCount: questions.length,
      // Named, not counted: "2 fields were skipped" is not something a trainer
      // can act on. The keys are, and they can re-add them in the builder.
      skipped,
      droppedLinkedFields: linkedIds.length - liveLinkedIds.length,
    },
    { status: 201 },
  )
}
