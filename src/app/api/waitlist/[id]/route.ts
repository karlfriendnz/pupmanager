import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

async function ownEntry(id: string, trainerId: string) {
  return prisma.waitlistEntry.findFirst({ where: { id, trainerId }, select: { id: true } })
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  packageId: z.string().min(1).nullable().optional(),
  request: z.string().max(2000).nullable().optional(),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']).nullable().optional(),
  preferredDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  preferredTimeStart: hhmm.nullable().optional(),
  preferredTimeEnd: hhmm.nullable().optional(),
  earliestStart: z.string().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  status: z.enum(['WAITING', 'CONTACTED', 'SCHEDULED', 'REMOVED']).optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  if (!(await ownEntry(id, trainerId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  if (d.packageId) {
    const pkg = await prisma.package.findFirst({
      where: { id: d.packageId, trainerId },
      select: { id: true },
    })
    if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })
  }

  // Status transitions stamp their timestamps once.
  const statusStamp =
    d.status === 'CONTACTED'
      ? { contactedAt: new Date() }
      : d.status === 'SCHEDULED'
        ? { convertedAt: new Date() }
        : {}

  const { earliestStart, ...rest } = d
  const entry = await prisma.waitlistEntry.update({
    where: { id },
    data: {
      ...rest,
      ...(earliestStart !== undefined
        ? { earliestStart: earliestStart ? new Date(earliestStart) : null }
        : {}),
      ...statusStamp,
    },
  })
  return NextResponse.json({ ok: true, status: entry.status })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  if (!(await ownEntry(id, trainerId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  await prisma.waitlistEntry.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
