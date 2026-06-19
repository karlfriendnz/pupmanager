import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { BOOKING_PAGE_DEFAULTS, uniqueBookingSlug } from '@/lib/booking-page'

// List + create the trainer's booking pages. Guarded by settings.edit (same
// scope as availability/branding).

export async function GET() {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx
  const pages = await prisma.bookingPage.findMany({
    where: { trainerId: ctx.companyId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json(pages)
}

const createSchema = z.object({ name: z.string().min(1).max(120).optional() })

export async function POST(req: Request) {
  const ctx = await guardPermission('settings.edit')
  if (ctx instanceof NextResponse) return ctx

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const name = parsed.data.name?.trim() || 'New booking page'
  const slug = await uniqueBookingSlug(ctx.companyId, name)
  const last = await prisma.bookingPage.findFirst({
    where: { trainerId: ctx.companyId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })

  const page = await prisma.bookingPage.create({
    data: {
      trainerId: ctx.companyId,
      name,
      slug,
      order: (last?.order ?? -1) + 1,
      ...BOOKING_PAGE_DEFAULTS,
    },
  })
  return NextResponse.json(page, { status: 201 })
}
