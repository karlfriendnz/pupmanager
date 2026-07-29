import { NextResponse } from 'next/server'
import { z } from 'zod'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

// PATCH /api/trainer/daycare/slots/[slotId]
//
// The limit on a day-part, set from the daycare board itself. Deliberately NOT
// the /api/packages PATCH: that one reconciles the whole slot list and can
// regenerate sessions, which is far too much machinery behind "make Wednesday
// six dogs". This writes one column.
//
// A slot IS one weekday's part, so the limit applies to that day every week —
// the board says as much before you save. There is no per-date limit to write:
// TrainingSession has no capacity of its own.
const schema = z.object({
  // null = no limit. 0 is allowed and means closed to new bookings, which is a
  // real thing a trainer wants on a day they're short-staffed.
  capacity: z.number().int().min(0).max(1000).nullable(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ slotId: string }> }) {
  const guard = await guardPermission('classes.manage')
  if (guard instanceof NextResponse) return guard

  const { slotId } = await params
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Give a whole number of dogs, or clear it for no limit.' }, { status: 400 })

  // The slot must belong to THIS company's daycare. Scoping on the package's
  // trainerId is the tenant boundary; isPuppySchool keeps this route off every
  // other kind of offering's slots, which have their own editor.
  const slot = await prisma.packageSessionSlot.findFirst({
    where: { id: slotId, package: { trainerId: guard.companyId, isPuppySchool: true } },
    select: { id: true },
  })
  if (!slot) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated = await prisma.packageSessionSlot.update({
    where: { id: slot.id },
    data: { capacity: parsed.data.capacity },
    select: { id: true, capacity: true },
  })
  return NextResponse.json({ ok: true, slot: updated })
}
