import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  businessName: z.string().min(1).optional(),
  // Grace period: an ISO datetime to grant access until, or null to clear.
  gracePeriodUntil: z.union([z.string().datetime(), z.null()]).optional(),
})

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return null
  return session
}

export async function PATCH(req: Request, { params }: { params: Promise<{ trainerId: string }> }) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { trainerId } = await params
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: trainerId, role: 'TRAINER' } })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { name, email, businessName, gracePeriodUntil } = parsed.data

  if (email && email !== user.email) {
    const conflict = await prisma.user.findUnique({ where: { email } })
    if (conflict) return NextResponse.json({ error: 'Email already in use' }, { status: 409 })
  }

  await prisma.user.update({
    where: { id: trainerId },
    data: { ...(name !== undefined && { name }), ...(email !== undefined && { email }) },
  })

  const profileData = {
    ...(businessName !== undefined && { businessName }),
    // null clears the grace period; a string sets it; undefined leaves it.
    ...(gracePeriodUntil !== undefined && {
      gracePeriodUntil: gracePeriodUntil === null ? null : new Date(gracePeriodUntil),
    }),
  }
  if (Object.keys(profileData).length > 0) {
    await prisma.trainerProfile.update({
      where: { userId: trainerId },
      data: profileData,
    })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ trainerId: string }> }) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { trainerId } = await params
  const user = await prisma.user.findUnique({
    where: { id: trainerId, role: 'TRAINER' },
    include: { trainerProfile: { select: { id: true } } },
  })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const trainerId2 = user.trainerProfile?.id
  if (trainerId2) {
    // Delete client users first (ClientProfile.trainerId has no cascade)
    const clients = await prisma.clientProfile.findMany({
      where: { trainerId: trainerId2 },
      select: { userId: true },
    })
    if (clients.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: clients.map(c => c.userId) } } })
    }
  }

  await prisma.user.delete({ where: { id: trainerId } })
  return NextResponse.json({ ok: true })
}
