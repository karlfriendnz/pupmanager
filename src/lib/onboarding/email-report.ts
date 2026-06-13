// Per-trainer onboarding/trial email report — what they've already received and
// what they're scheduled to get next. Powers the expandable row on the admin
// Trainers table. The "upcoming" prediction mirrors the eligibility + timing
// rules in send-emails.ts (runOnboardingEmailDispatch / isEligible) so the
// report can't quietly drift from what the cron will actually send.

import { prisma } from '@/lib/prisma'
import { getOnboardingState } from '@/lib/onboarding/state'
import { DRIP_ACTIVATION, SUPPRESSED_RECIPIENTS, PLATFORM_DOMAIN } from '@/lib/onboarding/send-emails'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

type Trigger = {
  type?: string
  hours?: number
  days?: number
  requireStepIncomplete?: string
  requireAhaNotReached?: boolean
  requireNoClientSignedIn?: boolean
}

export type SentEmail = { key: string; subject: string; senderKey: string; sentAt: string }

// status:
//  eligible  → conditions met; will go out on the next ~9am-local tick
//  scheduled → not due yet; `dueAt` is when it becomes eligible
//  waiting   → blocked on an event with no fixed date (first invite / first client sign-in)
//  skip      → will never send for this trainer (condition permanently failed)
export type UpcomingEmail = {
  key: string
  subject: string
  senderKey: string
  status: 'eligible' | 'scheduled' | 'waiting' | 'skip'
  dueAt: string | null
  note: string
}

export type TrainerEmailReport = {
  enrolled: boolean
  enrollmentNote: string | null
  timezone: string
  sent: SentEmail[]
  upcoming: UpcomingEmail[]
}

type Predicted = { status: UpcomingEmail['status']; dueAt: Date | null; note: string }

// Mirror isEligible() but, instead of a boolean, return WHEN/WHY so the admin
// can see the schedule. `now` is passed for testability/consistency.
function predict(
  rule: Trigger,
  ctx: {
    startedAt: Date
    ahaReachedAt: Date | null
    firstInviteSentAt: Date | null
    subscriptionStatus: string
    trialEndsAt: Date | null
    stepCompleted: (key: string) => boolean
  },
  now: number,
): Predicted {
  switch (rule.type) {
    case 'on_signup':
      return { status: 'eligible', dueAt: ctx.startedAt, note: 'On signup' }

    case 'after_signup': {
      if (rule.requireAhaNotReached && ctx.ahaReachedAt) {
        return { status: 'skip', dueAt: null, note: 'Skipped — a client has already signed in' }
      }
      if (rule.requireStepIncomplete && ctx.stepCompleted(rule.requireStepIncomplete)) {
        return { status: 'skip', dueAt: null, note: `Skipped — "${rule.requireStepIncomplete}" already done` }
      }
      const due = new Date(ctx.startedAt.getTime() + (rule.hours ?? 0) * HOUR_MS)
      const base = `${rule.hours ?? 0}h after signup`
      return now >= due.getTime()
        ? { status: 'eligible', dueAt: due, note: base }
        : { status: 'scheduled', dueAt: due, note: base }
    }

    case 'after_first_invite_sent': {
      if (!ctx.firstInviteSentAt) {
        return { status: 'waiting', dueAt: null, note: `${rule.hours ?? 0}h after first client invite is sent` }
      }
      if (rule.requireNoClientSignedIn && ctx.ahaReachedAt) {
        return { status: 'skip', dueAt: null, note: 'Skipped — a client has already signed in' }
      }
      const due = new Date(ctx.firstInviteSentAt.getTime() + (rule.hours ?? 0) * HOUR_MS)
      const base = `${rule.hours ?? 0}h after first invite`
      return now >= due.getTime()
        ? { status: 'eligible', dueAt: due, note: base }
        : { status: 'scheduled', dueAt: due, note: base }
    }

    case 'on_aha_reached':
      return ctx.ahaReachedAt
        ? { status: 'eligible', dueAt: ctx.ahaReachedAt, note: 'First client signed in' }
        : { status: 'waiting', dueAt: null, note: 'When the first client signs in' }

    case 'trial_days_left': {
      const target = rule.days ?? -1
      if (ctx.subscriptionStatus !== 'TRIALING' || !ctx.trialEndsAt) {
        return { status: 'skip', dueAt: null, note: 'Skipped — not on an active trial' }
      }
      const due = new Date(ctx.trialEndsAt.getTime() - target * DAY_MS)
      const daysLeft = Math.ceil((ctx.trialEndsAt.getTime() - now) / DAY_MS)
      const base = `${target} day${target === 1 ? '' : 's'} before trial ends`
      if (daysLeft === target) return { status: 'eligible', dueAt: due, note: base }
      if (daysLeft > target) return { status: 'scheduled', dueAt: due, note: base }
      return { status: 'skip', dueAt: due, note: `${base} — window passed` }
    }

    case 'trial_ended': {
      if (ctx.subscriptionStatus === 'ACTIVE' || !ctx.trialEndsAt) {
        return { status: 'skip', dueAt: null, note: 'Skipped — trainer is subscribed' }
      }
      const due = ctx.trialEndsAt
      return now >= due.getTime()
        ? { status: 'eligible', dueAt: due, note: 'When the trial ends' }
        : { status: 'scheduled', dueAt: due, note: 'When the trial ends' }
    }

    default:
      return { status: 'skip', dueAt: null, note: 'Unknown trigger' }
  }
}

/**
 * Build the received + upcoming email report for a single trainer.
 * @param trainerProfileId TrainerProfile.id (NOT the User id).
 */
export async function getTrainerEmailReport(trainerProfileId: string): Promise<TrainerEmailReport> {
  const [progress, published] = await Promise.all([
    prisma.trainerOnboardingProgress.findUnique({
      where: { trainerId: trainerProfileId },
      select: {
        startedAt: true,
        ahaReachedAt: true,
        firstInviteSentAt: true,
        emails: { select: { emailKey: true, sentAt: true } },
        trainer: {
          select: {
            subscriptionStatus: true,
            trialEndsAt: true,
            isInternal: true,
            user: { select: { email: true, deactivatedAt: true, timezone: true } },
          },
        },
      },
    }),
    prisma.onboardingEmail.findMany({
      where: { publishedAt: { not: null } },
      select: { key: true, subject: true, senderKey: true, triggerRule: true },
    }),
  ])

  const tz = progress?.trainer?.user?.timezone || 'Pacific/Auckland'

  // No progress row yet → nothing sent, and nothing scheduled until they first
  // open the app (which creates the row).
  if (!progress || !progress.trainer) {
    return { enrolled: false, enrollmentNote: 'No onboarding record yet (trainer hasn’t opened the app)', timezone: tz, sent: [], upcoming: [] }
  }

  // Map sent log → subject (keys may reference templates that were later
  // renamed/unpublished; fall back to the key).
  const subjectByKey = new Map(published.map(e => [e.key, e.subject]))
  const senderByKey = new Map(published.map(e => [e.key, e.senderKey]))
  const sent: SentEmail[] = progress.emails
    .map(e => ({
      key: e.emailKey,
      subject: subjectByKey.get(e.emailKey) ?? e.emailKey,
      senderKey: senderByKey.get(e.emailKey) ?? 'karl',
      sentAt: e.sentAt.toISOString(),
    }))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))

  // Enrollment gates (mirror runOnboardingEmailDispatch's per-trainer skips).
  const t = progress.trainer
  const email = t.user.email ?? ''
  let enrollmentNote: string | null = null
  if (!email || email.toLowerCase().endsWith(PLATFORM_DOMAIN) || SUPPRESSED_RECIPIENTS.has(email.toLowerCase())) {
    enrollmentNote = 'Not enrolled — platform/suppressed address'
  } else if (t.isInternal) {
    enrollmentNote = 'Not enrolled — internal (“Ours”) account'
  } else if (t.user.deactivatedAt) {
    enrollmentNote = 'Not enrolled — account is deactivated'
  } else if (progress.startedAt < DRIP_ACTIVATION) {
    enrollmentNote = 'Not enrolled — pre-launch cohort (signed up before the drip sequence went live)'
  }
  const enrolled = enrollmentNote === null

  // Only evaluate the step state if some rule actually needs it.
  const needsSteps = published.some(e => (e.triggerRule as Trigger)?.requireStepIncomplete)
  const completedSteps = new Set<string>()
  if (needsSteps && enrolled) {
    const state = await getOnboardingState(trainerProfileId)
    for (const s of state.steps) if (s.status === 'completed') completedSteps.add(s.key)
  }

  const now = Date.now()
  const sentKeys = new Set(progress.emails.map(e => e.emailKey))
  const upcoming: UpcomingEmail[] = []
  if (enrolled) {
    for (const tmpl of published) {
      if (sentKeys.has(tmpl.key)) continue
      const p = predict(tmpl.triggerRule as Trigger, {
        startedAt: progress.startedAt,
        ahaReachedAt: progress.ahaReachedAt,
        firstInviteSentAt: progress.firstInviteSentAt,
        subscriptionStatus: t.subscriptionStatus,
        trialEndsAt: t.trialEndsAt,
        stepCompleted: (k) => completedSteps.has(k),
      }, now)
      upcoming.push({
        key: tmpl.key,
        subject: tmpl.subject,
        senderKey: tmpl.senderKey,
        status: p.status,
        dueAt: p.dueAt ? p.dueAt.toISOString() : null,
        note: p.note,
      })
    }
    // Order: things that will actually go (eligible, then soonest scheduled),
    // then event-waiters, then skips. Within scheduled, earliest due first.
    const rank = { eligible: 0, scheduled: 1, waiting: 2, skip: 3 } as const
    upcoming.sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status]
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt)
      return a.dueAt ? -1 : b.dueAt ? 1 : 0
    })
  }

  return { enrolled, enrollmentNote, timezone: tz, sent, upcoming }
}
