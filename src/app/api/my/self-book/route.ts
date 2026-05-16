import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { safeEvaluate } from '@/lib/achievements'
import { generateSessionDates, createBookingAssignment } from '@/lib/self-book'

// GET  /api/my/self-book  — packages this client may self-book
// POST /api/my/self-book  — book one (instant or pending request)
async function clientCtx() {
  const active = await getActiveClient()
  if (!active) return null
  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { id: true, trainerId: true, dogId: true },
  })
  if (!profile) return null
  return { ...active, trainerId: profile.trainerId, dogId: profile.dogId }
}

export async function GET() {
  const ctx = await clientCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const packages = await prisma.package.findMany({
    where: { trainerId: ctx.trainerId, clientSelfBook: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, name: true, description: true, sessionCount: true,
      weeksBetween: true, durationMins: true, sessionType: true,
      priceCents: true, selfBookRequiresApproval: true,
    },
  })
  return NextResponse.json(packages)
}

const schema = z.object({
  packageId: z.string().min(1),
  // Client-chosen first-session datetime (ISO). Subsequent sessions are
  // placed on the package cadence from here.
  startDate: z.string().min(1),
})

export async function POST(req: Request) {
  const ctx = await clientCtx()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // A trainer previewing the client app must not create real bookings.
  if (ctx.isPreview) {
    return NextResponse.json({ error: 'Preview mode — booking disabled' }, { status: 403 })
  }

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const pkg = await prisma.package.findFirst({
    where: { id: parsed.data.packageId, trainerId: ctx.trainerId, clientSelfBook: true },
  })
  if (!pkg) return NextResponse.json({ error: 'Package not available' }, { status: 404 })

  const start = new Date(parsed.data.startDate)
  if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) {
    return NextResponse.json({ error: 'Pick a start time in the future' }, { status: 400 })
  }

  const dates = generateSessionDates(start, pkg.sessionCount, pkg.weeksBetween)

  if (pkg.selfBookRequiresApproval) {
    await prisma.bookingRequest.create({
      data: {
        trainerId: ctx.trainerId,
        clientId: ctx.clientId,
        packageId: pkg.id,
        dogId: ctx.dogId,
        sessionDates: dates.map(d => d.toISOString()),
      },
    })
    return NextResponse.json({ ok: true, mode: 'requested' }, { status: 201 })
  }

  // Instant book.
  await prisma.$transaction(tx =>
    createBookingAssignment(tx, {
      trainerId: ctx.trainerId,
      clientId: ctx.clientId,
      packageId: pkg.id,
      dogId: ctx.dogId,
      pkg,
      sessionDates: dates,
    }),
  )
  await safeEvaluate(ctx.clientId)
  return NextResponse.json({ ok: true, mode: 'booked' }, { status: 201 })
}
