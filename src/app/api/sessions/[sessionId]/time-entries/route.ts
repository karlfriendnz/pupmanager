import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { z } from 'zod'

// Per-member time logged against a session (billable hours). Anyone on the team
// can add/edit/delete entries and attribute them to any member of the business.
// minutes is the source of truth; the client sends/edits in hours.

const createSchema = z.object({
  membershipId: z.string().min(1),
  minutes: z.number().int().positive().max(24 * 60),
  rateCents: z.number().int().min(0).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
})

const patchSchema = z.object({
  id: z.string().min(1),
  membershipId: z.string().min(1).optional(),
  minutes: z.number().int().positive().max(24 * 60).optional(),
  rateCents: z.number().int().min(0).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
})

const deleteSchema = z.object({ id: z.string().min(1) })

function amountCents(minutes: number, rateCents: number | null): number | null {
  if (rateCents == null) return null
  return Math.round((minutes / 60) * rateCents)
}

// The session must belong to the caller's business.
async function ownsSession(sessionId: string, companyId: string) {
  return prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId: companyId },
    select: { id: true },
  })
}

// A membership the time can be attributed to must belong to the same business.
async function memberInCompany(membershipId: string, companyId: string) {
  return prisma.trainerMembership.findFirst({
    where: { id: membershipId, companyId },
    select: { id: true },
  })
}

function serialise(e: {
  id: string; membershipId: string; minutes: number; rateCents: number | null
  note: string | null; createdAt: Date
  membership: { user: { name: string | null; email: string } }
}) {
  return {
    id: e.id,
    membershipId: e.membershipId,
    memberName: e.membership.user.name ?? e.membership.user.email,
    minutes: e.minutes,
    rateCents: e.rateCents,
    amountCents: amountCents(e.minutes, e.rateCents),
    note: e.note,
    createdAt: e.createdAt.toISOString(),
  }
}

const ENTRY_INCLUDE = {
  membership: { select: { user: { select: { name: true, email: true } } } },
} as const

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId } = await params
  if (!(await ownsSession(sessionId, ctx.companyId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const entries = await prisma.sessionTimeEntry.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    include: ENTRY_INCLUDE,
  })
  return NextResponse.json({ entries: entries.map(serialise) })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId } = await params
  if (!(await ownsSession(sessionId, ctx.companyId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  if (!(await memberInCompany(parsed.data.membershipId, ctx.companyId))) {
    return NextResponse.json({ error: 'Unknown team member' }, { status: 400 })
  }

  const entry = await prisma.sessionTimeEntry.create({
    data: {
      sessionId,
      membershipId: parsed.data.membershipId,
      minutes: parsed.data.minutes,
      rateCents: parsed.data.rateCents ?? null,
      note: parsed.data.note ?? null,
      loggedById: ctx.membershipId,
    },
    include: ENTRY_INCLUDE,
  })
  return NextResponse.json(serialise(entry), { status: 201 })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId } = await params
  if (!(await ownsSession(sessionId, ctx.companyId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { id, membershipId, minutes, rateCents, note } = parsed.data

  // The entry must belong to this session.
  const existing = await prisma.sessionTimeEntry.findFirst({ where: { id, sessionId }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (membershipId && !(await memberInCompany(membershipId, ctx.companyId))) {
    return NextResponse.json({ error: 'Unknown team member' }, { status: 400 })
  }

  const entry = await prisma.sessionTimeEntry.update({
    where: { id },
    data: {
      ...(membershipId !== undefined && { membershipId }),
      ...(minutes !== undefined && { minutes }),
      ...(rateCents !== undefined && { rateCents }),
      ...(note !== undefined && { note }),
    },
    include: ENTRY_INCLUDE,
  })
  return NextResponse.json(serialise(entry))
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId } = await params
  if (!(await ownsSession(sessionId, ctx.companyId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { count } = await prisma.sessionTimeEntry.deleteMany({ where: { id: parsed.data.id, sessionId } })
  if (count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
