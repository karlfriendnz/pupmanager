import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { nextPriority } from '@/lib/waitlist'

// POST /api/my/waitlist — client self-adds to the trainer's general
// scheduling waitlist (the "no slots fit" fallback from self-book).
const schema = z.object({
  packageId: z.string().min(1).nullable().optional(),
  request: z.string().max(2000).nullable().optional(),
})

export async function POST(req: Request) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (active.isPreview) {
    return NextResponse.json({ error: 'Preview mode' }, { status: 403 })
  }

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { id: true, trainerId: true, user: { select: { name: true, email: true } } },
  })
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  if (parsed.data.packageId) {
    const pkg = await prisma.package.findFirst({
      where: { id: parsed.data.packageId, trainerId: profile.trainerId },
      select: { id: true },
    })
    if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })
  }

  // Don't stack duplicate active entries for the same client.
  const existing = await prisma.waitlistEntry.findFirst({
    where: { trainerId: profile.trainerId, clientId: profile.id, status: 'WAITING' },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json({ ok: true, alreadyWaiting: true })
  }

  const max = await prisma.waitlistEntry.aggregate({
    where: { trainerId: profile.trainerId },
    _max: { priority: true },
  })

  await prisma.waitlistEntry.create({
    data: {
      trainerId: profile.trainerId,
      clientId: profile.id,
      name: profile.user.name ?? 'Client',
      email: profile.user.email ?? null,
      packageId: parsed.data.packageId ?? null,
      request: parsed.data.request?.trim() || 'Requested via self-booking — no slots fit',
      priority: nextPriority(max._max.priority),
    },
  })
  return NextResponse.json({ ok: true }, { status: 201 })
}
