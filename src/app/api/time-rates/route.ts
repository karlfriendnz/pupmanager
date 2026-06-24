import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'

export const runtime = 'nodejs'

const createSchema = z.object({
  name: z.string().min(1).max(80),
  rateCents: z.number().int().min(0).max(10_000_00),
  sortOrder: z.number().int().min(0).max(999).optional(),
})

// Named hourly rates are company-wide config. Anyone in the company can read
// them (for the entry picker); only the OWNER can create/edit/archive them.
export async function GET() {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const rates = await prisma.timeRate.findMany({
    where: { companyId: ctx.companyId, archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, rateCents: true, sortOrder: true },
  })
  return NextResponse.json({ rates })
}

export async function POST(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'Only the owner can manage rates' }, { status: 403 })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const rate = await prisma.timeRate.create({
    data: { companyId: ctx.companyId, name: parsed.data.name, rateCents: parsed.data.rateCents, sortOrder: parsed.data.sortOrder ?? 0 },
    select: { id: true, name: true, rateCents: true, sortOrder: true },
  })
  return NextResponse.json({ rate })
}
