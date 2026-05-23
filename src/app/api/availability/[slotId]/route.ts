import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const patchSchema = z.object({
  title: z.string().optional().nullable(),
  dayOfWeek: z.number().int().min(1).max(7).optional().nullable(),
  date: z.string().optional().nullable(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  cadenceWeeks: z.number().int().min(1).max(8).optional(),
  firstDate: z.string().optional().nullable(),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slotId: string }> }
) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { slotId } = await params

  const slot = await prisma.availabilitySlot.findFirst({
    where: { id: slotId, trainerId },
  })
  if (!slot) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const data: Record<string, unknown> = {}
  if ('title' in parsed.data)     data.title     = parsed.data.title ?? null
  if ('dayOfWeek' in parsed.data) data.dayOfWeek = parsed.data.dayOfWeek ?? null
  if ('date' in parsed.data)      data.date      = parsed.data.date ? new Date(parsed.data.date) : null
  if ('startTime' in parsed.data) data.startTime = parsed.data.startTime
  if ('endTime' in parsed.data)   data.endTime   = parsed.data.endTime
  if ('cadenceWeeks' in parsed.data) data.cadenceWeeks = parsed.data.cadenceWeeks ?? 1
  if ('firstDate' in parsed.data) data.firstDate = parsed.data.firstDate ? new Date(parsed.data.firstDate) : null

  const updated = await prisma.availabilitySlot.update({
    where: { id: slotId },
    data,
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slotId: string }> }
) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { slotId } = await params

  const slot = await prisma.availabilitySlot.findFirst({
    where: { id: slotId, trainerId },
  })
  if (!slot) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.availabilitySlot.delete({ where: { id: slotId } })
  return NextResponse.json({ ok: true })
}
