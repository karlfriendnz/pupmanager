import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { AUTOMATION_DEFAULTS } from '@/lib/booking-automations'

// List + create automations on a booking page. Guarded by settings.edit.

async function ownedPage(trainerId: string, id: string) {
  return prisma.bookingPage.findFirst({ where: { id, trainerId }, select: { id: true } })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!(await ownedPage(ctx.companyId, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const automations = await prisma.bookingAutomation.findMany({
    where: { bookingPageId: id },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json(automations)
}

const createSchema = z.object({ trigger: z.enum(['ON_BOOKING', 'BEFORE_SESSION', 'AFTER_SESSION']) })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params
  if (!(await ownedPage(ctx.companyId, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const defaults = AUTOMATION_DEFAULTS[parsed.data.trigger]
  const last = await prisma.bookingAutomation.findFirst({
    where: { bookingPageId: id },
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  const automation = await prisma.bookingAutomation.create({
    data: {
      bookingPageId: id,
      trigger: parsed.data.trigger,
      offsetMinutes: defaults.offsetMinutes,
      subject: defaults.subject,
      body: defaults.body,
      order: (last?.order ?? -1) + 1,
    },
  })
  return NextResponse.json(automation, { status: 201 })
}
