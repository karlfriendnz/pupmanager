'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PREVIEW_COOKIE } from '@/lib/client-context'

// One-hour preview window. Long enough for a thorough walk-through, short
// enough that a forgotten cookie doesn't keep the trainer "logged in" as
// a client across sessions.
const PREVIEW_TTL_SECONDS = 60 * 60

export async function enterClientPreview(clientId: string) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    throw new Error('Unauthorised')
  }
  const client = await prisma.clientProfile.findFirst({
    where: { id: clientId, trainerId: session.user.trainerId },
    select: { id: true },
  })
  if (!client) throw new Error('Client not found')

  const store = await cookies()
  store.set(PREVIEW_COOKIE, clientId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: PREVIEW_TTL_SECONDS,
  })
  redirect('/home')
}

export async function exitClientPreview(returnTo?: string) {
  const store = await cookies()
  const previewId = store.get(PREVIEW_COOKIE)?.value
  store.delete(PREVIEW_COOKIE)

  // Exiting the preview means the trainer has *seen* the client view —
  // satisfy the "see it from your client's side" onboarding step. Best-
  // effort: only mark complete if the trainer's progress row exists and
  // the step is published. Errors are swallowed so a transient DB issue
  // doesn't block the redirect (the worst outcome is the step staying
  // pending until the trainer clicks the explicit confirm).
  try {
    const session = await auth()
    if (session?.user?.role === 'TRAINER' && session.user.trainerId) {
      const step = await prisma.onboardingStep.findUnique({
        where: { key: 'client_view' },
        select: { publishedAt: true },
      })
      const progress = await prisma.trainerOnboardingProgress.findUnique({
        where: { trainerId: session.user.trainerId },
        select: { id: true },
      })
      if (step?.publishedAt && progress) {
        await prisma.trainerOnboardingStepProgress.upsert({
          where: { progressId_stepKey: { progressId: progress.id, stepKey: 'client_view' } },
          create: { progressId: progress.id, stepKey: 'client_view', completedAt: new Date() },
          update: { completedAt: new Date(), skippedAt: null },
        })
      }
    }
  } catch (err) {
    console.error('[exitClientPreview] failed to mark client_view complete', err)
  }

  if (returnTo) redirect(returnTo)
  // Default: send the trainer to their dashboard so the freshly-completed
  // step is reflected on the home screen (and the celebration fires if
  // that was the last one).
  redirect('/dashboard')
}
