import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

// Update / delete a single automation on a booking page. Guarded by
// settings.edit; the automation must belong to a page owned by the trainer.

async function ownedAutomation(trainerId: string, pageId: string, autoId: string) {
  return prisma.bookingAutomation.findFirst({
    where: { id: autoId, bookingPageId: pageId, bookingPage: { trainerId } },
    select: { id: true },
  })
}

const schema = z.object({
  trigger: z.enum(['ON_BOOKING', 'BEFORE_SESSION', 'AFTER_SESSION']).optional(),
  offsetMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
  enabled: z.boolean().optional(),
  subject: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(4000).optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; autoId: string }> }) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx
  const { id, autoId } = await params
  if (!(await ownedAutomation(ctx.companyId, id, autoId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  const updated = await prisma.bookingAutomation.update({
    where: { id: autoId },
    data: {
      ...(d.trigger !== undefined && { trigger: d.trigger }),
      ...(d.offsetMinutes !== undefined && { offsetMinutes: d.offsetMinutes }),
      ...(d.enabled !== undefined && { enabled: d.enabled }),
      ...(d.subject !== undefined && { subject: d.subject.trim() }),
      ...(d.body !== undefined && { body: d.body }),
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; autoId: string }> }) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx
  const { id, autoId } = await params
  if (!(await ownedAutomation(ctx.companyId, id, autoId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.bookingAutomation.delete({ where: { id: autoId } })
  return NextResponse.json({ ok: true })
}
