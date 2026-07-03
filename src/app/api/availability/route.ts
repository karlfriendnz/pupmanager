import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  // The form sends `null` when the title is empty — accept both null and
  // undefined so the body parses cleanly either way.
  title: z.string().nullable().optional(),
  dayOfWeek: z.number().int().min(1).max(7).optional().nullable(),
  date: z.string().optional().nullable(),       // ISO date string for one-off
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  // 1 = weekly (default), 2 = fortnightly, etc. Only used for repeating
  // (dayOfWeek-based) slots.
  cadenceWeeks: z.number().int().min(1).max(8).optional(),
  // ISO date — anchor week for cadenceWeeks > 1.
  firstDate: z.string().optional().nullable(),
})

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const slots = await prisma.availabilitySlot.findMany({
    where: { trainerId },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  })

  return NextResponse.json(slots)
}

export async function POST(req: Request) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const slot = await prisma.availabilitySlot.create({
    data: {
      trainerId,
      title: parsed.data.title?.trim() || null,
      dayOfWeek: parsed.data.dayOfWeek ?? null,
      date: parsed.data.date ? new Date(parsed.data.date) : null,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      cadenceWeeks: parsed.data.cadenceWeeks ?? 1,
      firstDate: parsed.data.firstDate ? new Date(parsed.data.firstDate) : null,
    },
  })

  // Best-effort: mirror the slot onto the trainer's Google Calendar (no-ops when
  // the add-on is off or Google isn't connected). Never breaks the save.
  try {
    const { syncAvailabilitySlotToGoogle } = await import('@/lib/google-calendar-sync')
    await syncAvailabilitySlotToGoogle(slot.id)
  } catch {
    // Non-critical
  }

  return NextResponse.json(slot, { status: 201 })
}
