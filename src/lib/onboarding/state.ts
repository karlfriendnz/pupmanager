// Computes the full OnboardingState for a trainer — published steps with
// per-step status (live-derived where possible, explicit otherwise), aha
// timestamps, dismissal flags, and the "waiting on" client name.
//
// Wrapped with React cache so the trainer layout + dashboard page (both server
// components in the same request) share a single computation. Without this we
// double up to 16 parallel Prisma queries per dashboard render and blow the
// Supabase 15-connection pool. The cache is per-request — different requests
// still re-fetch.

import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import type { OnboardingState, OnboardingStepView, StepStatus } from './types'

// Steps with no live-state signal — completion only flips when the trainer
// clicks "Confirm — looks good" in the modal. Empty for now: every step
// either auto-completes via live state OR via CTA click (see
// COMPLETE_ON_CTA_CLICK in the panel).
const EXPLICIT_ONLY_KEYS = new Set<string>()

// Computes what the floating "Continue setup" card on trainer pages should
// show: hidden, or visible with the next-incomplete step's metadata. Reuses
// the full state helper so the next step is live-derived (not just based on
// explicit skip/complete records).
export async function getOnboardingFabState(trainerId: string): Promise<{
  show: boolean
  nextStep: { key: string; title: string; order: number } | null
  totalSteps: number
}> {
  const state = await getOnboardingState(trainerId)
  const totalSteps = state.steps.length

  if (state.ahaReachedAt || state.checklistDismissedAt) {
    return { show: false, nextStep: null, totalSteps }
  }

  // Priority order for "what's next up": fresh pending > skipped > in-progress.
  // The trainer is actively *working on* in-progress steps (they clicked the
  // CTA), so the FAB should point past those to whatever they haven't touched
  // or have decided to defer. If everything is started, fall back to skipped
  // first (re-engage their decisions), then in-progress (last resort).
  const next =
    state.steps.find(s => s.status === 'pending') ??
    state.steps.find(s => s.status === 'skipped') ??
    state.steps.find(s => s.status === 'in_progress')
  if (!next) {
    // All steps done but no aha yet — trainer is in limbo, the dashboard
    // limbo card handles that, no need to nag from the FAB.
    return { show: false, nextStep: null, totalSteps }
  }

  return {
    show: true,
    nextStep: { key: next.key, title: next.title, order: next.order },
    totalSteps,
  }
}

async function getOnboardingStateImpl(trainerId: string): Promise<OnboardingState> {
  // 4 queries instead of 8: profile + per-relation counts collapse into one
  // findUnique via _count, and the limbo client doubles as the "any client
  // exists" signal so we drop the separate clientCount query.
  const [steps, progress, profileWithCounts, limbo] = await Promise.all([
    prisma.onboardingStep.findMany({
      where: { publishedAt: { not: null } },
      orderBy: { order: 'asc' },
    }),
    prisma.trainerOnboardingProgress.findUnique({
      where: { trainerId },
      select: {
        ahaReachedAt: true,
        backfilledAt: true,
        checklistDismissedAt: true,
        welcomeShownAt: true,
        steps: { select: { stepKey: true, completedAt: true, skippedAt: true, startedAt: true } },
      },
    }),
    prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: {
        businessName: true,
        phone: true,
        logoUrl: true,
        intakeFormPublished: true,
        _count: {
          select: {
            embedForms: { where: { isActive: true } },
            sessionForms: { where: { isActive: true } },
            packages: true,
            clients: true,
            customFields: true,
            achievements: { where: { published: true } },
            trainingSessions: true,
          },
        },
      },
    }),
    prisma.clientProfile.findFirst({
      where: { trainerId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { name: true, email: true } },
        dog: { select: { name: true } },
      },
    }),
  ])

  const counts = profileWithCounts?._count ?? { embedForms: 0, sessionForms: 0, packages: 0, clients: 0, customFields: 0, achievements: 0, trainingSessions: 0 }

  // intake_form completes when AT LEAST ONE form is published — embed form,
  // session form, or the intake form itself. Trainer has to actively publish
  // something they reviewed before the wizard advances past this step.
  const anyFormPublished =
    !!profileWithCounts?.intakeFormPublished ||
    counts.embedForms > 0 ||
    counts.sessionForms > 0

  // Live-derived completion — a step is "done" if either the underlying state
  // exists OR the trainer explicitly marked it complete. achievements is
  // gated on the trainer publishing at least one badge (drafts don't count).
  const liveDerived: Record<string, boolean> = {
    business_profile: !!profileWithCounts?.businessName?.trim(),
    intake_form: anyFormPublished,
    program_package: counts.packages > 0,
    achievements: counts.achievements > 0,
    invite_client: counts.clients > 0,
    schedule_session: counts.trainingSessions > 0,
  }

  const explicit = new Map<string, { completed: boolean; skipped: boolean; started: boolean }>()
  for (const sp of progress?.steps ?? []) {
    explicit.set(sp.stepKey, {
      completed: !!sp.completedAt,
      skipped: !!sp.skippedAt,
      started: !!sp.startedAt,
    })
  }

  const stepViews: OnboardingStepView[] = steps.map(s => {
    const exp = explicit.get(s.key)
    let status: StepStatus
    if (liveDerived[s.key] || exp?.completed) status = 'completed'
    else if (exp?.skipped) status = 'skipped'
    else if (exp?.started) status = 'in_progress'
    else status = 'pending'
    return {
      key: s.key,
      order: s.order,
      title: s.title,
      body: s.body,
      ctaLabel: s.ctaLabel,
      ctaHref: s.ctaHref,
      skippable: s.skippable,
      skipWarning: s.skipWarning,
      status,
    }
  })

  // Limbo: only show when no aha yet AND there's a client to be waiting on.
  const showLimbo = !progress?.ahaReachedAt && limbo
  const limboClient = showLimbo
    ? {
        id: limbo!.id,
        name: limbo!.user.name ?? limbo!.user.email,
        dogName: limbo!.dog?.name ?? null,
      }
    : null

  return {
    steps: stepViews,
    ahaReachedAt: progress?.ahaReachedAt?.toISOString() ?? null,
    backfilledAt: progress?.backfilledAt?.toISOString() ?? null,
    checklistDismissedAt: progress?.checklistDismissedAt?.toISOString() ?? null,
    welcomeShownAt: progress?.welcomeShownAt?.toISOString() ?? null,
    limboClient,
    explicitOnlyStepKeys: Array.from(EXPLICIT_ONLY_KEYS),
  }
}

export const getOnboardingState = cache(getOnboardingStateImpl)
