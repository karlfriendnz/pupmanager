import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Marks the first-visit welcome modal as shown. Called when the trainer
// clicks either "Start the quick setup" or "Skip" — both dismiss the welcome
// permanently. Idempotent (only writes if currently null).
export async function POST() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await prisma.trainerOnboardingProgress.updateMany({
    where: { trainerId, welcomeShownAt: null },
    data: { welcomeShownAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}
