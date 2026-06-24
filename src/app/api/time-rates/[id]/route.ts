import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'

export const runtime = 'nodejs'

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  rateCents: z.number().int().min(0).max(10_000_00).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'Only the owner can manage rates' }, { status: 403 })

  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const result = await prisma.timeRate.updateMany({
    where: { id, companyId: ctx.companyId },
    data: parsed.data,
  })
  if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const rate = await prisma.timeRate.findUnique({ where: { id }, select: { id: true, name: true, rateCents: true, sortOrder: true } })
  return NextResponse.json({ rate })
}

// Soft-delete (archive) so historical entries that snapshotted this rate keep
// their name/amount and finalised timesheets stay intact.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'Only the owner can manage rates' }, { status: 403 })

  const { id } = await params
  const result = await prisma.timeRate.updateMany({
    where: { id, companyId: ctx.companyId, archivedAt: null },
    data: { archivedAt: new Date() },
  })
  if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
