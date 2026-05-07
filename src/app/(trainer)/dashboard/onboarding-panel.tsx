'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Check, Circle, MinusCircle, X, ArrowRight, Clock, MessageSquare, Send, Sparkles, Building2, ClipboardList, Notebook, Package, Trophy, Eye, Mail, PawPrint, AlertTriangle, Play, Calendar, type LucideIcon } from 'lucide-react'

// Steps where clicking the CTA is the trainer's confirmation that they've
// done the step (no separate "Confirm" button needed). client_view sends the
// trainer to /preview-as — opening it counts as "I've seen what my clients see."
const COMPLETE_ON_CTA_CLICK = new Set(['client_view'])

const STEP_ICON: Record<string, LucideIcon> = {
  business_profile: Building2,
  intake_form: ClipboardList,
  session_form: Notebook,
  program_package: Package,
  achievements: Trophy,
  client_view: Eye,
  invite_client: Mail,
  schedule_session: Calendar,
}
import { cn } from '@/lib/utils'
import type { OnboardingState, OnboardingStepView } from '@/lib/onboarding/types'

const SESSION_AUTOOPEN_KEY = 'pm-onboarding-autoopened-v1'

export function OnboardingPanel({ state }: { state: OnboardingState }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const forceOpen = searchParams.get('wizard') === '1'
  const [modalStepKey, setModalStepKey] = useState<string | null>(null)
  const [optedInToTour, setOptedInToTour] = useState(false)
  // Track welcome dismissal locally so we don't flash the modal again before
  // the router refresh round-trip completes.
  const [welcomeDismissedLocal, setWelcomeDismissedLocal] = useState(false)

  const dismissed = !!state.checklistDismissedAt
  const ahaReached = !!state.ahaReachedAt
  const isBackfill = !!state.backfilledAt
  const welcomeShown = !!state.welcomeShownAt || welcomeDismissedLocal
  const showWelcome = !welcomeShown && !isBackfill && !dismissed && !ahaReached
  const completedCount = state.steps.filter(s => s.status === 'completed').length
  const totalCount = state.steps.length
  const allComplete = completedCount === totalCount

  // Next step the "Continue setup" button jumps to. Same priority as the FAB:
  // fresh pending > skipped > in-progress. Mirrors getOnboardingFabState.
  const nextStep = useMemo(
    () =>
      state.steps.find(s => s.status === 'pending') ??
      state.steps.find(s => s.status === 'skipped') ??
      state.steps.find(s => s.status === 'in_progress') ??
      null,
    [state.steps],
  )

  // Auto-open the wizard modal once per browser session for fresh signups —
  // but ONLY if the welcome modal has already been shown. Otherwise welcome
  // takes precedence.
  useEffect(() => {
    if (dismissed || ahaReached || isBackfill) return
    if (showWelcome) return
    if (!nextStep) return
    if (typeof window === 'undefined') return
    if (sessionStorage.getItem(SESSION_AUTOOPEN_KEY)) return
    sessionStorage.setItem(SESSION_AUTOOPEN_KEY, '1')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModalStepKey(nextStep.key)
  }, [dismissed, ahaReached, isBackfill, showWelcome, nextStep])

  // Force-open from the floating "Continue setup" button on other pages.
  // ?wizard=1 always wins, even over backfill banner / dismissed state, because
  // the trainer explicitly clicked it to come here.
  useEffect(() => {
    if (!forceOpen || !nextStep) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModalStepKey(nextStep.key)
    // Strip the query param so refresh doesn't re-pop the modal.
    const url = new URL(window.location.href)
    url.searchParams.delete('wizard')
    window.history.replaceState({}, '', url.toString())
  }, [forceOpen, nextStep])

  // Backfilled trainer who hasn't opted in → show the opt-in banner only.
  // Hide everything else (no checklist, no modal) until they choose.
  if (dismissed || ahaReached) {
    // Even when complete/aha, show a brief celebration if it just happened —
    // for v1 we keep it simple and just hide the panel.
    return null
  }

  if (showWelcome) {
    return (
      <WelcomeModal
        onStart={async () => {
          setWelcomeDismissedLocal(true)
          await fetch('/api/onboarding/welcome/dismiss', { method: 'POST' })
          if (nextStep) setModalStepKey(nextStep.key)
          router.refresh()
        }}
        onSkip={async () => {
          setWelcomeDismissedLocal(true)
          await fetch('/api/onboarding/welcome/dismiss', { method: 'POST' })
          router.refresh()
        }}
      />
    )
  }

  if (isBackfill && !optedInToTour) {
    return (
      <BackfillBanner
        onTakeTour={() => {
          setOptedInToTour(true)
          if (nextStep) setModalStepKey(nextStep.key)
        }}
        onDismiss={async () => {
          await fetch('/api/onboarding/checklist/dismiss', { method: 'POST' })
          router.refresh()
        }}
      />
    )
  }

  return (
    <>
      <ChecklistWidget
        steps={state.steps}
        completedCount={completedCount}
        totalCount={totalCount}
        allComplete={allComplete}
        onResume={() => nextStep && setModalStepKey(nextStep.key)}
        onOpenStep={(key) => setModalStepKey(key)}
        onDismiss={async () => {
          await fetch('/api/onboarding/checklist/dismiss', { method: 'POST' })
          router.refresh()
        }}
      />

      {/* LimboCard removed per request — the checklist already conveys the
          "waiting for client to register" state implicitly via the wizard's
          last-step status. */}

      {modalStepKey && (
        <WizardModal
          steps={state.steps}
          stepKey={modalStepKey}
          explicitOnlyStepKeys={state.explicitOnlyStepKeys}
          onChangeStep={setModalStepKey}
          onClose={() => setModalStepKey(null)}
          onRefresh={() => router.refresh()}
        />
      )}
    </>
  )
}

// ─── Welcome modal (first visit) ────────────────────────────────────────────

function WelcomeModal({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const [busy, setBusy] = useState<'start' | 'skip' | null>(null)

  async function handle(which: 'start' | 'skip') {
    setBusy(which)
    try {
      if (which === 'start') await onStart()
      else await onSkip()
    } finally { setBusy(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-md animate-pm-fade">
      <div className="relative w-full max-w-xl bg-white rounded-3xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.4)] overflow-hidden animate-pm-pop">
        {/* Video placeholder — drop in a real <video> or iframe src when ready */}
        <div className="relative aspect-video bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 overflow-hidden">
          <div aria-hidden className="absolute inset-0 opacity-[0.07] flex items-center justify-evenly select-none">
            <PawPrint className="h-14 w-14 text-white rotate-[-12deg]" />
            <PawPrint className="h-16 w-16 text-white rotate-[8deg] translate-y-3" />
            <PawPrint className="h-14 w-14 text-white rotate-[-6deg]" />
            <PawPrint className="h-16 w-16 text-white rotate-[14deg] -translate-y-2" />
          </div>
          <div className="relative h-full grid place-items-center">
            <button
              type="button"
              aria-label="Play welcome video (placeholder)"
              className="grid place-items-center h-20 w-20 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm ring-2 ring-white/40 text-white transition-all hover:scale-105"
            >
              <Play className="h-9 w-9 ml-1" fill="currentColor" />
            </button>
          </div>
          <p className="absolute bottom-3 left-0 right-0 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
            Welcome video · 90 seconds
          </p>
        </div>

        <div className="px-7 py-7">
          <h2 className="text-2xl font-bold text-slate-900 leading-tight">
            Welcome to PupManager
          </h2>
          <p className="text-[15px] text-slate-600 mt-3 leading-relaxed">
            Hey, glad to have you. PupManager is built to give you back the evenings
            you&apos;ve been losing to admin. We&apos;ve got a quick 6-step setup that gets you
            ready to invite your first client — most trainers finish it in under 15 minutes.
          </p>

          <div className="mt-6 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => handle('start')}
              disabled={busy !== null}
              className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold px-5 py-3.5 text-sm shadow-md shadow-blue-600/25 hover:shadow-lg hover:shadow-blue-600/35 hover:-translate-y-px active:translate-y-0 transition-all disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {busy === 'start' ? 'Starting…' : 'Start the quick setup'}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <button
              type="button"
              onClick={() => handle('skip')}
              disabled={busy !== null}
              className="text-sm text-slate-500 hover:text-slate-700 px-2 py-2 self-center transition-colors disabled:opacity-50"
            >
              {busy === 'skip' ? 'Skipping…' : 'Skip for now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Backfill opt-in banner ──────────────────────────────────────────────────

function BackfillBanner({ onTakeTour, onDismiss }: { onTakeTour: () => void; onDismiss: () => void }) {
  return (
    <div className="mb-6 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-violet-50 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900">Want to take the new setup tour?</h3>
          <p className="text-sm text-slate-600 mt-0.5">
            We&apos;ve added a guided setup with intake forms, achievements, and a client preview. Worth a few minutes if you haven&apos;t seen the latest features.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={onTakeTour} size="sm">Take the tour</Button>
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
            >
              No thanks
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Checklist widget ────────────────────────────────────────────────────────

function ChecklistWidget({
  steps, completedCount, totalCount, allComplete,
  onResume, onOpenStep, onDismiss,
}: {
  steps: OnboardingStepView[]
  completedCount: number
  totalCount: number
  allComplete: boolean
  onResume: () => void
  onOpenStep: (key: string) => void
  onDismiss: () => void
}) {
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  return (
    <Card className="mb-6 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900">
            {allComplete ? "You're all set up!" : 'Get set up'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {allComplete
              ? 'Waiting on your first client to register.'
              : `${completedCount} of ${totalCount} steps done`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!allComplete && (
            <Button size="sm" onClick={onResume}>
              Continue setup
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          )}
          <button
            type="button"
            aria-label="Dismiss setup checklist"
            onClick={onDismiss}
            className="text-slate-400 hover:text-slate-700 p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mb-4 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full bg-blue-600 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      <ul className="flex flex-col gap-1">
        {steps.map(s => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => onOpenStep(s.key)}
              className={cn(
                'w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left text-sm transition-colors',
                'hover:bg-slate-50',
                s.status === 'completed' && 'text-slate-400'
              )}
            >
              <StepIcon status={s.status} />
              {(() => {
                const StepLucide = STEP_ICON[s.key] ?? PawPrint
                return (
                  <StepLucide
                    className={cn(
                      'h-4 w-4 shrink-0',
                      s.status === 'completed' ? 'text-slate-300' : 'text-slate-500',
                    )}
                    strokeWidth={1.75}
                  />
                )
              })()}
              <span className={cn(
                'flex-1 truncate',
                s.status === 'completed' && 'line-through',
              )}>
                {s.title}
              </span>
              {s.status === 'skipped' && (
                <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600">Skipped</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function StepIcon({ status }: { status: OnboardingStepView['status'] }) {
  if (status === 'completed') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shrink-0">
        <Check className="h-3 w-3" />
      </span>
    )
  }
  if (status === 'skipped') {
    return <MinusCircle className="h-5 w-5 text-amber-400 shrink-0" />
  }
  return <Circle className="h-5 w-5 text-slate-300 shrink-0" />
}

// ─── Limbo card ──────────────────────────────────────────────────────────────

function LimboCard({ client }: { client: NonNullable<OnboardingState['limboClient']> }) {
  return (
    <Card className="mb-6 p-4 sm:p-5 border-amber-200 bg-amber-50">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
          <Clock className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-amber-900">
            Waiting for {client.name}{client.dogName ? ` (${client.dogName})` : ''} to register
          </h3>
          <p className="text-sm text-amber-800/80 mt-0.5">
            Once they sign in for the first time, your setup is complete and we&apos;ll send you a celebration email.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={`/clients/${client.id}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-white border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              <Send className="h-3.5 w-3.5" />
              Resend invite
            </a>
            <a
              href={`/clients/${client.id}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-white border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Try a different channel
            </a>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ─── Wizard modal ────────────────────────────────────────────────────────────

function WizardModal({
  steps, stepKey, explicitOnlyStepKeys,
  onChangeStep, onClose, onRefresh,
}: {
  steps: OnboardingStepView[]
  stepKey: string
  explicitOnlyStepKeys: string[]
  onChangeStep: (key: string) => void
  onClose: () => void
  onRefresh: () => void
}) {
  const [pendingSkip, setPendingSkip] = useState<OnboardingStepView | null>(null)
  const [busy, setBusy] = useState(false)
  // Marks a step as "just completed" so its indicator dot animates briefly
  // before the modal advances. Cleared by the celebrate timer in complete().
  const [justCompletedKey, setJustCompletedKey] = useState<string | null>(null)

  const stepIndex = steps.findIndex(s => s.key === stepKey)
  const step = steps[stepIndex]
  if (!step) return null

  const isExplicitOnly = explicitOnlyStepKeys.includes(step.key)
  // After completing/skipping current step, advance using the same priority as
  // the FAB: pending > skipped > in_progress, but only for steps after this one.
  const nextPendingOrSkipped =
    steps.find((s, i) => i > stepIndex && s.status === 'pending') ??
    steps.find((s, i) => i > stepIndex && s.status === 'skipped') ??
    steps.find((s, i) => i > stepIndex && s.status === 'in_progress')

  async function complete() {
    if (!step) return
    setBusy(true)
    try {
      await fetch(`/api/onboarding/steps/${step.key}/complete`, { method: 'POST' })
      // Trigger celebration on the indicator dot before advancing. Don't clear
      // — server state refresh is async and clearing too early reverts the
      // dot to "pending" before s.status === 'completed' has propagated.
      // Letting it persist is harmless: the dot stays green-with-check (which
      // is correct), and the next completion just shifts the marker.
      setJustCompletedKey(step.key)
      onRefresh()
      // Hold so the trainer sees the dot pop + ring pulse before we advance.
      await new Promise(resolve => setTimeout(resolve, 700))
      if (nextPendingOrSkipped) onChangeStep(nextPendingOrSkipped.key)
      else onClose()
    } finally {
      setBusy(false)
    }
  }

  async function skip(force = false) {
    if (!step) return
    if (step.skipWarning && !force) {
      setPendingSkip(step)
      return
    }
    setBusy(true)
    try {
      await fetch(`/api/onboarding/steps/${step.key}/skip`, { method: 'POST' })
      onRefresh()
      setPendingSkip(null)
      if (nextPendingOrSkipped) onChangeStep(nextPendingOrSkipped.key)
      else onClose()
    } finally {
      setBusy(false)
    }
  }

  const StepIconForHero = STEP_ICON[step.key] ?? PawPrint
  const stepNumber = stepIndex + 1

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-md animate-pm-fade">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.4)] overflow-hidden animate-pm-pop">
        <button
          type="button"
          aria-label="Close setup"
          onClick={onClose}
          className="absolute top-3 right-3 z-20 grid place-items-center h-9 w-9 rounded-full bg-white/15 text-white hover:bg-white/30 backdrop-blur-sm transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Hero band — gradient + per-step icon */}
        <div className="relative h-36 bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 overflow-hidden">
          <div aria-hidden className="absolute inset-0 opacity-[0.07] flex items-center justify-evenly select-none">
            <PawPrint className="h-12 w-12 text-white rotate-[-12deg]" />
            <PawPrint className="h-14 w-14 text-white rotate-[8deg] translate-y-2" />
            <PawPrint className="h-12 w-12 text-white rotate-[-6deg] -translate-y-1" />
            <PawPrint className="h-14 w-14 text-white rotate-[14deg]" />
          </div>
          <div className="relative h-full flex items-center justify-center">
            <span className="grid place-items-center h-20 w-20 rounded-2xl bg-white/15 backdrop-blur-sm ring-1 ring-white/20 text-white drop-shadow-md">
              <StepIconForHero className="h-10 w-10" strokeWidth={1.75} />
            </span>
          </div>
        </div>

        {/* Floating step indicator pill — overlaps hero/card boundary.
            Completed steps get a small white paw inside the green dot. */}
        <div className="relative -mt-4 px-6 z-10 flex justify-center">
          <div className="inline-flex items-center gap-1.5 bg-white rounded-full px-2.5 py-1.5 shadow-lg ring-1 ring-slate-200/60">
            {steps.map((s, i) => {
              const isCurrent = i === stepIndex
              // Treat just-completed as completed in the UI so the dot looks
              // green + check during the celebration, even if the server-state
              // refresh hasn't propagated yet.
              const isCompleted = s.status === 'completed' || justCompletedKey === s.key
              const isSkipped = s.status === 'skipped'
              const isCelebrating = justCompletedKey === s.key
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-label={`Go to step ${i + 1}: ${s.title}`}
                  onClick={() => onChangeStep(s.key)}
                  className={cn(
                    'transition-all rounded-full grid place-items-center text-white',
                    isCelebrating && 'animate-pm-celebrate',
                    isCompleted
                      ? 'w-9 h-9 bg-emerald-500 hover:scale-110'
                      : isCurrent
                        ? 'w-9 h-9 bg-blue-600 shadow-md shadow-blue-600/30'
                        : isSkipped
                          ? 'w-2 h-2 bg-amber-400 hover:scale-125'
                          : 'w-2 h-2 bg-slate-200 hover:bg-slate-300 hover:scale-125',
                  )}
                >
                  {isCompleted
                    ? <Check className="h-5 w-5" strokeWidth={3} />
                    : isCurrent && <PawPrint className="h-5 w-5" strokeWidth={2.25} />}
                </button>
              )
            })}
          </div>
        </div>

        <div className="px-7 pt-5 pb-7">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-blue-600">
            Quick setup · Step {stepNumber} of {steps.length}
          </p>
          <h2 className="text-2xl font-bold text-slate-900 mt-1.5 leading-tight">{step.title}</h2>
          <p className="text-[15px] text-slate-600 mt-3 leading-relaxed whitespace-pre-line">{step.body}</p>

          <div className="mt-7 flex flex-col gap-2.5">
            <a
              href={step.ctaHref}
              onClick={() => {
                // Fire-and-forget: mark the step as "in progress" before nav so
                // the FAB on the destination page can advance past it. Don't
                // await — navigation should not be blocked by this.
                fetch(`/api/onboarding/steps/${step.key}/start`, { method: 'POST' }).catch(() => {})
                // Some steps treat the CTA click itself as confirmation.
                if (COMPLETE_ON_CTA_CLICK.has(step.key)) {
                  fetch(`/api/onboarding/steps/${step.key}/complete`, { method: 'POST' }).catch(() => {})
                }
              }}
              className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold px-5 py-3.5 text-sm shadow-md shadow-blue-600/25 hover:shadow-lg hover:shadow-blue-600/35 hover:-translate-y-px active:translate-y-0 transition-all"
            >
              {step.ctaLabel}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>

            {isExplicitOnly && (
              <Button
                variant="secondary"
                onClick={complete}
                loading={busy}
              >
                <Check className="h-4 w-4" />
                Confirm — looks good
              </Button>
            )}

            {step.skippable && step.status !== 'completed' && (
              <button
                type="button"
                onClick={() => skip(false)}
                disabled={busy}
                className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5 self-center transition-colors"
              >
                Skip for now
              </button>
            )}
          </div>
        </div>
      </div>

      {pendingSkip?.skipWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-pm-fade">
          <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 animate-pm-pop">
            <div className="flex items-start gap-3 mb-3">
              <span className="grid place-items-center h-10 w-10 rounded-full bg-amber-100 text-amber-600 shrink-0"><AlertTriangle className="h-5 w-5" /></span>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-slate-900">Are you sure?</h3>
                <p className="text-sm text-slate-600 mt-1.5">{pendingSkip.skipWarning}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingSkip(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                Go back
              </button>
              <Button variant="secondary" onClick={() => skip(true)} loading={busy}>
                Skip anyway
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
