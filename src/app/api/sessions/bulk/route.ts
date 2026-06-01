import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { safeEvaluate } from '@/lib/achievements'
import { z } from 'zod'

const schema = z.object({
  ids: z.array(z.string()).min(1).max(300),
  status: z.enum(['UPCOMING', 'COMPLETED', 'COMMENTED', 'INVOICED']).optional(),
  invoiced: z.boolean().optional(),
})

// Bulk-update sessions (used by the "to do" screen to mark several complete +
// invoiced at once). Scoped to the caller's trainer; ids they don't own are
// silently ignored. Re-evaluates achievements per affected client on a status
// change, mirroring the single-session PATCH.
export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { ids, status, invoiced } = parsed.data
  if (status === undefined && invoiced === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const owned = await prisma.trainingSession.findMany({
    where: { id: { in: ids }, trainerId },
    select: { id: true, clientId: true, dog: { select: { primaryFor: { take: 1, select: { id: true } } } } },
  })
  const ownedIds = owned.map(s => s.id)
  if (ownedIds.length === 0) return NextResponse.json({ updated: 0 })

  await prisma.trainingSession.updateMany({
    where: { id: { in: ownedIds } },
    data: {
      ...(status !== undefined ? { status } : {}),
      ...(invoiced !== undefined ? { invoicedAt: invoiced ? new Date() : null } : {}),
    },
  })

  if (status !== undefined) {
    const clientIds = new Set<string>()
    for (const s of owned) {
      const cid = s.clientId ?? s.dog?.primaryFor[0]?.id ?? null
      if (cid) clientIds.add(cid)
    }
    for (const cid of clientIds) await safeEvaluate(cid)
  }

  return NextResponse.json({ updated: ownedIds.length })
}
