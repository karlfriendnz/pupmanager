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

  const step = await prisma.onboardingStep.findUnique({
    where: { key },
    select: { publishedAt: true, skippable: true },
  })
  if (!step || !step.publishedAt) return NextResponse.json({ error: 'Step not found' }, { status: 404 })
  if (!step.skippable) return NextResponse.json({ error: 'Step is not skippable' }, { status: 400 })

  const progress = await prisma.trainerOnboardingProgress.findUnique({
    where: { trainerId },
    select: { id: true },
  })
  if (!progress) return NextResponse.json({ error: 'Onboarding not initialised' }, { status: 409 })

  await prisma.trainerOnboardingStepProgress.upsert({
    where: { progressId_stepKey: { progressId: progress.id, stepKey: key } },
    create: { progressId: progress.id, stepKey: key, skippedAt: new Date() },
    // Don't clear completedAt — if the step was already completed, skipping it
    // is a no-op (the status resolver already prefers completed over skipped).
    update: { skippedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
