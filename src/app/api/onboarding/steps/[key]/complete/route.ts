import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { key } = await ctx.params

  // Verify the step exists & is published before recording completion — admins
  // can unpublish a step and we don't want orphaned progress rows.
  const step = await prisma.onboardingStep.findUnique({ where: { key }, select: { publishedAt: true } })
  if (!step || !step.publishedAt) return NextResponse.json({ error: 'Step not found' }, { status: 404 })

  const progress = await prisma.trainerOnboardingProgress.findUnique({
    where: { trainerId },
    select: { id: true },
  })
  if (!progress) return NextResponse.json({ error: 'Onboarding not initialised' }, { status: 409 })

  await prisma.trainerOnboardingStepProgress.upsert({
    where: { progressId_stepKey: { progressId: progress.id, stepKey: key } },
    create: { progressId: progress.id, stepKey: key, completedAt: new Date() },
    update: { completedAt: new Date(), skippedAt: null },
  })

  return NextResponse.json({ ok: true })
}
