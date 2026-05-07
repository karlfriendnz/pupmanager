// Idempotently bootstrap a trainer into the onboarding system.
//
// Called from the trainer dashboard on every load — cheap when the row already
// exists, side-effects only on first visit. Safe to call concurrently thanks
// to the upsert + the achievement-count guard.

import { prisma } from '@/lib/prisma'
import { DEFAULT_ACHIEVEMENTS } from '@/lib/achievement-defaults'
import { seedDefaultFormsFor } from './form-defaults'

// Trainers older than this when we first see them are treated as backfill
// (existed before onboarding shipped) — the dashboard suppresses the auto-modal
// and instead shows an opt-in banner.
const BACKFILL_GRACE_MS = 60 * 60 * 1000

export async function initTrainerOnboarding(trainerId: string): Promise<void> {
  const existing = await prisma.trainerOnboardingProgress.findUnique({
    where: { trainerId },
    select: { id: true },
  })
  if (existing) return

  const profile = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { createdAt: true },
  })
  if (!profile) return

  const isBackfill = Date.now() - profile.createdAt.getTime() > BACKFILL_GRACE_MS

  // Seed default achievements only if the trainer has none yet — existing
  // trainers with custom sets are left untouched.
  const achievementCount = await prisma.achievement.count({ where: { trainerId } })
  if (achievementCount === 0) {
    await prisma.achievement.createMany({
      data: DEFAULT_ACHIEVEMENTS.map(a => ({ ...a, trainerId })),
    })
  }

  // Seed default contact / intake / session forms (idempotent per type).
  // Gives the "Review your forms" wizard step real content to review.
  await seedDefaultFormsFor(prisma, trainerId)

  // Upsert handles the race where two tabs hit the dashboard simultaneously.
  await prisma.trainerOnboardingProgress.upsert({
    where: { trainerId },
    create: { trainerId, backfilledAt: isBackfill ? new Date() : null },
    update: {},
  })
}
