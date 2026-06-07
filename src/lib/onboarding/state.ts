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

export interface FabStep {
  key: string
  title: string
  order: number
  ctaHref: string
  status: 'pending' | 'in_progress' | 'completed' | 'skipped'
  demo?: boolean
}

// Computes what the floating "Continue setup" card on trainer pages should
// show: hidden, or visible with the full step list + the next-incomplete
// step's metadata. The FAB needs every step (not just the next one) so it
// can resolve the page the trainer is currently on to a step and reflect
// that step's status — completed, skipped, or still pending.
export async function getOnboardingFabState(trainerId: string): Promise<{
  show: boolean
  nextStep: FabStep | null
  steps: FabStep[]
  totalSteps: number
  /**
   * True when every published step has status === 'completed' (no pending,
   * in_progress, or skipped). The trainer layout uses this to fire a
   * one-shot celebration overlay once they've crossed the finish line.
   * Independent of `show` — the FAB always hides at this point, but the
   * celebration is what marks the moment.
   */
  allComplete: boolean
}> {
  const state = await getOnboardingState(trainerId)
  const allSteps: FabStep[] = state.steps.map(s => ({
    key: s.key,
    title: s.title,
    order: s.order,
    ctaHref: s.ctaHref,
    status: s.status,
    demo: s.demo,
  }))
  const totalSteps = allSteps.length
  const allComplete = totalSteps > 0 && allSteps.every(s => s.status === 'completed')

  if (state.ahaReachedAt || state.checklistDismissedAt) {
    return { show: false, nextStep: null, steps: allSteps, totalSteps, allComplete }
  }

  // Hard gate: the tour-driven nudges (FAB, sidebar pulse dot, in-page
  // hints) only fire after the trainer has explicitly opted IN. Before
  // that they're either looking at the welcome modal (fresh signup)
  // or the backfill banner (existing trainer) and the tour chrome
  // would be jumping ahead of their decision.
  if (!state.tourStartedAt) {
    return { show: false, nextStep: null, steps: allSteps, totalSteps, allComplete }
  }

  // Priority for "what's next up": first incomplete step in order, where
  // "incomplete" includes both pending and in-progress. A step that the
  // trainer started but didn't finish still needs finishing — the previous
  // logic skipped past in-progress steps which made the FAB point at
  // step 4 while step 3 was demonstrably half-done. Skipped steps are
  // tried last (the trainer chose to defer them).
  const next =
    allSteps.find(s => s.status === 'pending' || s.status === 'in_progress') ??
    allSteps.find(s => s.status === 'skipped')
  if (!next) {
    return { show: false, nextStep: null, steps: allSteps, totalSteps, allComplete }
  }

  return {
    show: true,
    nextStep: next,
    steps: allSteps,
    totalSteps,
    allComplete,
  }
}

async function getOnboardingStateImpl(trainerId: string): Promise<OnboardingState> {
  // 4 queries instead of 8: profile + per-relation counts collapse into one
  // findUnique via _count, and the limbo client doubles as the "any client
  // exists" signal so we drop the separate clientCount query.
  const [
    steps, progress, profileWithCounts, limbo, invitedClientCount, staffCount,
    realClients, realPackages, realAchievements, realAvailability, realSessions,
  ] = await Promise.all([
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
        tourStartedAt: true,
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
            availabilitySlots: true,
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
    // Clients who've actually been sent an invite (vs just added). Drives
    // invite_client completion, kept distinct from create_client which only
    // needs any client record to exist.
    prisma.clientProfile.count({ where: { trainerId, invitedAt: { not: null } } }),
    // Team members beyond the owner — any MANAGER/STAFF membership (pending or
    // accepted) means the trainer has invited someone. Drives invite_staff.
    prisma.trainerMembership.count({ where: { companyId: trainerId, role: { not: 'OWNER' } } }),
    // REAL (non-sample) counts for the sample-able steps. When a step is
    // satisfied only by demo/sample data (total > 0 but real === 0) the UI
    // labels it "Demo data" so the trainer knows it isn't done for real yet.
    prisma.clientProfile.count({ where: { trainerId, isSample: false } }),
    prisma.package.count({ where: { trainerId, isSample: false } }),
    prisma.achievement.count({ where: { trainerId, isSample: false, published: true } }),
    prisma.availabilitySlot.count({ where: { trainerId, isSample: false } }),
    // A session is "real" unless it belongs to a sample client — demo sessions
    // are always attached to sample clients.
    prisma.trainingSession.count({ where: { trainerId, NOT: { client: { isSample: true } } } }),
  ])

  const counts = profileWithCounts?._count ?? { embedForms: 0, sessionForms: 0, packages: 0, clients: 0, customFields: 0, achievements: 0, trainingSessions: 0, availabilitySlots: 0 }

  // A step is "demo-only" when it's satisfied purely by sample data: the total
  // (which includes sample rows) is > 0 but the real count is 0. Keyed by step.
  const demoOnly: Record<string, boolean> = {
    create_client: counts.clients > 0 && realClients === 0,
    program_package: counts.packages > 0 && realPackages === 0,
    achievements: counts.achievements > 0 && realAchievements === 0,
    availability: counts.availabilitySlots > 0 && realAvailability === 0,
    schedule_session: counts.trainingSessions > 0 && realSessions === 0,
  }

  // Live-derived completion — a step is "done" if either the underlying state
  // exists OR the trainer explicitly marked it complete.
  //
  // intake_form is keyed *only* off intakeFormPublished, not "any form is
  // active". The previous version bailed the trainer out of this step if any
  // embed/session form happened to be active (e.g. a default seeded one
  // toggled on), which let them skip past actually reviewing+publishing the
  // intake form. They have to publish their intake form specifically.
  //
  // availability completes once the trainer has set even one weekly slot —
  // the message is "block out *some* time", not "fully fill in your week".
  const liveDerived: Record<string, boolean> = {
    availability: counts.availabilitySlots > 0,
    business_profile: !!profileWithCounts?.businessName?.trim(),
    intake_form: !!profileWithCounts?.intakeFormPublished,
    program_package: counts.packages > 0,
    achievements: counts.achievements > 0,
    // create_client: any client record exists (added or invited).
    create_client: counts.clients > 0,
    // invite_client: a client has actually been sent an invite. A client
    // merely "added" via the create_client step (invitedAt null) doesn't
    // complete this — the trainer still has to send the invite.
    invite_client: invitedClientCount > 0,
    schedule_session: counts.trainingSessions > 0,
    // invite_staff: any non-owner team member has been invited.
    invite_staff: staffCount > 0,
    // show_notes + download_app have no live signal — they complete on CTA
    // click (see COMPLETE_ON_CTA_CLICK in onboarding-panel.tsx).
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
    // Completed only because demo/sample data exists (no real record yet, and
    // the trainer didn't explicitly confirm the step).
    const demo = status === 'completed' && !exp?.completed && !!demoOnly[s.key]
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
      demo,
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
    tourStartedAt: progress?.tourStartedAt?.toISOString() ?? null,
    limboClient,
    explicitOnlyStepKeys: Array.from(EXPLICIT_ONLY_KEYS),
  }
}

export const getOnboardingState = cache(getOnboardingStateImpl)
