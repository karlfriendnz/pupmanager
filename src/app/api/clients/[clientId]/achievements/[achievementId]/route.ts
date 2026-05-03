import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'

// DELETE — revoke an award for this client. Used when a trainer mis-awards a
// MANUAL achievement; revoking an auto-rule award is allowed too (it'll
// re-award the next time the engine runs if the client still qualifies).
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ clientId: string; achievementId: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const { clientId, achievementId } = await ctx.params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access || !access.canEdit) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.clientAchievement.deleteMany({
    where: { clientId, achievementId, achievement: { trainerId: access.client.trainerId } },
  })

  return NextResponse.json({ ok: true })
}
