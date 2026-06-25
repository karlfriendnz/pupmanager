import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { mondayOf } from '@/lib/timesheets'
import { resolveTargetUserId } from './_access'

export const runtime = 'nodejs'

const createSchema = z.object({
  weekStart: z.string().datetime().or(z.string().min(8)).optional(),
  title: z.string().max(120).optional(),
  // TrainerMembership id of the member to create the sheet for. Honoured only
  // for owners/managers; ignored otherwise (scoped to self).
  member: z.string().optional(),
})

// Timesheets are per-user within a company. A user sees their own; owners and
// managers can view another member's via ?member=<membershipId>.
export async function GET(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const memberId = new URL(req.url).searchParams.get('member')
  const targetUserId = await resolveTargetUserId(ctx, memberId)

  const sheets = await prisma.timesheet.findMany({
    where: { companyId: ctx.companyId, userId: targetUserId },
    orderBy: { weekStart: 'desc' },
    select: {
      id: true, weekStart: true, title: true, status: true, finalisedAt: true, sentAt: true,
      entries: { select: { minutes: true, amountCents: true } },
    },
  })
  const list = sheets.map(s => ({
    id: s.id,
    weekStart: s.weekStart,
    title: s.title,
    status: s.status,
    finalisedAt: s.finalisedAt,
    sentAt: s.sentAt,
    entryCount: s.entries.length,
    totalMinutes: s.entries.reduce((n, e) => n + e.minutes, 0),
    totalCents: s.entries.reduce((n, e) => n + e.amountCents, 0),
  }))
  return NextResponse.json({ timesheets: list })
}

export async function POST(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Snap the picked date to the Monday of its week — sheets are a fixed
  // Mon 00:00 → Sun 23:59 period. The same member can only have one sheet per
  // week, so if one already exists for this week we reuse it rather than
  // creating a duplicate (the picker is "any day in the week").
  const week = mondayOf(parsed.data.weekStart ? new Date(parsed.data.weekStart) : new Date())
  const targetUserId = await resolveTargetUserId(ctx, parsed.data.member)

  const existing = await prisma.timesheet.findFirst({
    where: { companyId: ctx.companyId, userId: targetUserId, weekStart: week },
    select: { id: true },
  })
  if (existing) return NextResponse.json({ timesheet: existing, existed: true })

  const timesheet = await prisma.timesheet.create({
    data: { companyId: ctx.companyId, userId: targetUserId, weekStart: week, title: parsed.data.title || null },
    select: { id: true },
  })
  return NextResponse.json({ timesheet })
}
