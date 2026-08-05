import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

// Reorder a journey's steps — the drag handle's endpoint.
//
// A journey's ORDER IS ITS BEHAVIOUR: `availableSteps` walks the steps by
// `order` and stops at the first unfinished blocking one, so dragging the
// account step above the intake form genuinely changes what happens to the next
// person who enquires. That is why this is a real write and not a screen-only
// preference — and why a reload has to come back in the order the trainer left
// it (AGENTS.md bug #1).
//
// Chevron buttons were not an option: reordering in this app is drag, always.

const schema = z.object({
  // The step ids, top to bottom.
  ids: z.array(z.string().min(1)).min(1).max(200),
})

export async function POST(req: Request, { params }: { params: Promise<{ formId: string }> }) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx
  const { formId } = await params

  const form = await prisma.form.findFirst({ where: { id: formId, trainerId: ctx.companyId }, select: { id: true } })
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Every id must be a step of THIS form. Without this a caller could post
  // somebody else's step id and have its `order` rewritten — the ids are the
  // only thing the browser supplies, so they are the only thing to check.
  const owned = await prisma.commsFlowStep.findMany({
    where: { formId, id: { in: parsed.data.ids } },
    select: { id: true },
  })
  if (owned.length !== parsed.data.ids.length) {
    return NextResponse.json({ error: 'Some steps were not found' }, { status: 404 })
  }

  await prisma.$transaction(
    parsed.data.ids.map((id, index) => prisma.commsFlowStep.update({ where: { id }, data: { order: index } })),
  )

  const steps = await prisma.commsFlowStep.findMany({
    where: { formId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json(steps)
}
