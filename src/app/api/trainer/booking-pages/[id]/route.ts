import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { uniqueBookingSlug } from '@/lib/booking-page'

// Update / delete a single booking page. Guarded by settings.edit.

async function ownedPage(trainerId: string, id: string) {
  return prisma.bookingPage.findFirst({ where: { id, trainerId }, select: { id: true } })
}

const schema = z.object({
  name: z.string().min(1).max(120).optional(),
  // Only changed when explicitly provided — renaming the page keeps its slug so
  // shared links don't break.
  slug: z.string().max(60).optional(),
  enabled: z.boolean().optional(),
  headline: z.string().max(200).optional().nullable(),
  intro: z.string().max(1000).optional().nullable(),
  slotLengthMins: z.number().int().min(15).max(480).optional(),
  slotIntervalMins: z.number().int().min(5).max(480).optional(),
  requiresApproval: z.boolean().optional(),
  minNoticeHours: z.number().int().min(0).max(720).optional(),
  windowDays: z.number().int().min(1).max(120).optional(),
  availStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  availEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  availDays: z.array(z.number().int().min(1).max(7)).optional(),
  packageId: z.string().nullable().optional(),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']).optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!(await ownedPage(ctx.companyId, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  if (d.packageId) {
    const pkg = await prisma.package.findFirst({ where: { id: d.packageId, trainerId: ctx.companyId }, select: { id: true } })
    if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 400 })
  }

  // Resolve a unique slug when one was supplied (deduped within the trainer).
  const slug = d.slug !== undefined ? await uniqueBookingSlug(ctx.companyId, d.slug, id) : undefined

  const updated = await prisma.bookingPage.update({
    where: { id },
    data: {
      ...(d.name !== undefined && { name: d.name.trim() }),
      ...(slug !== undefined && { slug }),
      ...(d.enabled !== undefined && { enabled: d.enabled }),
      ...(d.headline !== undefined && { headline: d.headline?.trim() || null }),
      ...(d.intro !== undefined && { intro: d.intro?.trim() || null }),
      ...(d.slotLengthMins !== undefined && { slotLengthMins: d.slotLengthMins }),
      ...(d.slotIntervalMins !== undefined && { slotIntervalMins: d.slotIntervalMins }),
      ...(d.requiresApproval !== undefined && { requiresApproval: d.requiresApproval }),
      ...(d.minNoticeHours !== undefined && { minNoticeHours: d.minNoticeHours }),
      ...(d.windowDays !== undefined && { windowDays: d.windowDays }),
      ...(d.availStartTime !== undefined && { availStartTime: d.availStartTime }),
      ...(d.availEndTime !== undefined && { availEndTime: d.availEndTime }),
      ...(d.availDays !== undefined && { availDays: d.availDays }),
      ...(d.packageId !== undefined && { packageId: d.packageId }),
      ...(d.sessionType !== undefined && { sessionType: d.sessionType }),
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!(await ownedPage(ctx.companyId, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.bookingPage.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
