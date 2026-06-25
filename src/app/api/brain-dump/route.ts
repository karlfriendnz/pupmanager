import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'

export const runtime = 'nodejs'

// The dashboard brain dump is per (company, user): each trainer has their own
// freeform note within a business. Scoped via getTrainerContext().

// GET — the current user's brain-dump body for the active company (or "" when
// they've never written one).
export async function GET() {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const dump = await prisma.trainerBrainDump.findUnique({
    where: { companyId_userId: { companyId: ctx.companyId, userId: ctx.userId } },
    select: { body: true, updatedAt: true },
  })

  return NextResponse.json({ body: dump?.body ?? '', updatedAt: dump?.updatedAt ?? null })
}

const putSchema = z.object({ body: z.string().max(50_000) })

// PUT — upsert the body. The panel debounces and calls this as the trainer types.
export async function PUT(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const dump = await prisma.trainerBrainDump.upsert({
    where: { companyId_userId: { companyId: ctx.companyId, userId: ctx.userId } },
    create: { companyId: ctx.companyId, userId: ctx.userId, body: parsed.data.body },
    update: { body: parsed.data.body },
    select: { updatedAt: true },
  })

  return NextResponse.json({ ok: true, updatedAt: dump.updatedAt })
}
