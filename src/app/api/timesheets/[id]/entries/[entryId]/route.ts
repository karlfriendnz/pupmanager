import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { entrySchema, resolveLine, resolveClientId } from '@/lib/timesheet-line'

export const runtime = 'nodejs'

// Confirm the entry belongs to a DRAFT timesheet owned by the caller.
async function ownDraftEntry(timesheetId: string, entryId: string) {
  const ctx = await getTrainerContext()
  if (!ctx) return { error: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }) }
  const sheet = await prisma.timesheet.findFirst({ where: { id: timesheetId, companyId: ctx.companyId, userId: ctx.userId }, select: { status: true } })
  if (!sheet) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (sheet.status !== 'DRAFT') return { error: NextResponse.json({ error: 'This timesheet is finalised and can no longer be edited' }, { status: 409 }) }
  const entry = await prisma.timeEntry.findFirst({ where: { id: entryId, timesheetId }, select: { id: true } })
  if (!entry) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { ctx }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params
  const r = await ownDraftEntry(id, entryId)
  if ('error' in r) return r.error

  const parsed = entrySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const [line, clientId] = await Promise.all([
    resolveLine(r.ctx.companyId, parsed.data),
    resolveClientId(r.ctx.companyId, parsed.data.clientId),
  ])

  await prisma.timeEntry.update({
    where: { id: entryId },
    data: {
      date: new Date(parsed.data.date),
      task: parsed.data.task,
      minutes: parsed.data.minutes,
      rateId: line.rateId,
      rateName: line.rateName,
      rateCents: line.rateCents,
      amountCents: line.amountCents,
      clientId,
      category: parsed.data.category || null,
      notes: parsed.data.notes || null,
    },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params
  const r = await ownDraftEntry(id, entryId)
  if ('error' in r) return r.error
  await prisma.timeEntry.delete({ where: { id: entryId } })
  return NextResponse.json({ ok: true })
}
