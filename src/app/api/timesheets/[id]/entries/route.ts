import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { entrySchema, resolveLine, resolveClientId } from '@/lib/timesheet-line'

export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const sheet = await prisma.timesheet.findFirst({ where: { id, companyId: ctx.companyId, userId: ctx.userId }, select: { status: true } })
  if (!sheet) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (sheet.status !== 'DRAFT') return NextResponse.json({ error: 'This timesheet is finalised and can no longer be edited' }, { status: 409 })

  const parsed = entrySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const [line, clientId, last] = await Promise.all([
    resolveLine(ctx.companyId, parsed.data),
    resolveClientId(ctx.companyId, parsed.data.clientId),
    prisma.timeEntry.findFirst({ where: { timesheetId: id }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } }),
  ])

  const entry = await prisma.timeEntry.create({
    data: {
      timesheetId: id,
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
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    select: { id: true },
  })
  return NextResponse.json({ entry })
}
