import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'

export const runtime = 'nodejs'

// Lock a timesheet: DRAFT → FINALISED. Entries can no longer be edited.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const sheet = await prisma.timesheet.findFirst({
    where: { id, companyId: ctx.companyId, userId: ctx.userId },
    select: { status: true, _count: { select: { entries: true } } },
  })
  if (!sheet) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (sheet.status === 'FINALISED') return NextResponse.json({ ok: true })
  if (sheet._count.entries === 0) return NextResponse.json({ error: 'Add at least one entry before finalising' }, { status: 400 })

  await prisma.timesheet.update({ where: { id }, data: { status: 'FINALISED', finalisedAt: new Date() } })
  return NextResponse.json({ ok: true })
}

// Reopen a finalised timesheet for further edits (FINALISED → DRAFT).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const result = await prisma.timesheet.updateMany({
    where: { id, companyId: ctx.companyId, userId: ctx.userId, status: 'FINALISED' },
    data: { status: 'DRAFT', finalisedAt: null },
  })
  if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
