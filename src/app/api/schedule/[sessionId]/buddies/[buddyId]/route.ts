import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { accessibleSessionWhere } from '@/lib/session-access'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string; buddyId: string }> }
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = ctx.companyId

  const { sessionId, buddyId } = await params

  // Walk through the session to confirm the caller can access it
  const buddy = await prisma.sessionBuddy.findFirst({
    where: { id: buddyId, sessionId, session: { trainerId, ...accessibleSessionWhere(ctx) } },
    select: { id: true },
  })
  if (!buddy) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.sessionBuddy.delete({ where: { id: buddyId } })
  return NextResponse.json({ ok: true })
}
