import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // updateMany so we no-op safely if the row doesn't exist yet (e.g. trainer
  // dismisses without ever opening the dashboard).
  await prisma.trainerOnboardingProgress.updateMany({
    where: { trainerId, checklistDismissedAt: null },
    data: { checklistDismissedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
