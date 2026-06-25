import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { sheetScope } from '../_access'

export const runtime = 'nodejs'

const updateSchema = z.object({
  title: z.string().max(120).nullable().optional(),
  notes: z.string().max(5_000).nullable().optional(),
  recipientEmail: z.string().email().nullable().optional().or(z.literal('')),
})

// Ownership: a user may touch their own timesheets; owners/managers may touch
// any member's within the active company (sheetScope handles the role gate).
async function own(id: string) {
  const ctx = await getTrainerContext()
  if (!ctx) return { error: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }) }
  const sheet = await prisma.timesheet.findFirst({ where: { id, ...sheetScope(ctx) } })
  if (!sheet) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { ctx, sheet }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await own(id)
  if ('error' in r) return r.error
  const { ctx, sheet } = r

  const [entries, rates, company, clients] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { timesheetId: id },
      orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { client: { select: { id: true, user: { select: { name: true } } } } },
    }),
    prisma.timeRate.findMany({
      where: { companyId: ctx.companyId, archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, rateCents: true },
    }),
    prisma.trainerProfile.findUnique({
      where: { id: ctx.companyId },
      select: { businessName: true, payoutCurrency: true, user: { select: { email: true } } },
    }),
    prisma.clientProfile.findMany({
      where: { trainerId: ctx.companyId },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { id: true, user: { select: { name: true } } },
    }),
  ])

  return NextResponse.json({
    timesheet: {
      id: sheet.id, weekStart: sheet.weekStart, title: sheet.title, status: sheet.status,
      notes: sheet.notes, recipientEmail: sheet.recipientEmail, finalisedAt: sheet.finalisedAt, sentAt: sheet.sentAt,
    },
    entries: entries.map(e => ({
      id: e.id, date: e.date, task: e.task, minutes: e.minutes,
      rateId: e.rateId, rateName: e.rateName, rateCents: e.rateCents, amountCents: e.amountCents,
      clientId: e.clientId, clientName: e.client?.user?.name ?? null, category: e.category, notes: e.notes,
    })),
    rates,
    clients: clients.map(c => ({ id: c.id, name: c.user?.name ?? 'Client' })),
    currency: company?.payoutCurrency ?? 'nzd',
    businessName: company?.businessName ?? 'PupManager',
    ownerEmail: company?.user?.email ?? null,
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await own(id)
  if ('error' in r) return r.error

  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { title, notes, recipientEmail } = parsed.data

  await prisma.timesheet.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title: title || null } : {}),
      ...(notes !== undefined ? { notes: notes || null } : {}),
      ...(recipientEmail !== undefined ? { recipientEmail: recipientEmail || null } : {}),
    },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await own(id)
  if ('error' in r) return r.error
  await prisma.timesheet.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
