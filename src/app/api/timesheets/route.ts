import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { mondayOf } from '@/lib/timesheets'

export const runtime = 'nodejs'

const createSchema = z.object({
  weekStart: z.string().datetime().or(z.string().min(8)).optional(),
  title: z.string().max(120).optional(),
})

// Timesheets are per-user within a company. A user only sees their own.
export async function GET() {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const sheets = await prisma.timesheet.findMany({
    where: { companyId: ctx.companyId, userId: ctx.userId },
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

  const week = mondayOf(parsed.data.weekStart ? new Date(parsed.data.weekStart) : new Date())

  const timesheet = await prisma.timesheet.create({
    data: { companyId: ctx.companyId, userId: ctx.userId, weekStart: week, title: parsed.data.title || null },
    select: { id: true },
  })
  return NextResponse.json({ timesheet })
}
