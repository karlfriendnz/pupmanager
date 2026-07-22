'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Check, MinusCircle, X, ArrowRight, ChevronRight, Clock, MessageSquare, Send, Sparkles, Building2, ClipboardList, Notebook, Package, Eye, Mail, PawPrint, Play, Calendar, UserPlus, NotebookPen, Users, Smartphone, Apple, Wallet, Globe, type LucideIcon } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'

// App-store destinations the download QR codes point at. The Apple URL is
// the live App Store listing (locale-agnostic — Apple auto-redirects to the
// user's region). PLAY_STORE_URL is still a placeholder until the Android
// listing is live.
const APP_STORE_URL = 'https://apps.apple.com/app/id6766399138'
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.pupmanager.app'

// Steps where clicking the CTA is the trainer's confirmation that they've
// done the step (no separate "Confirm" button needed). client_view sends the
// trainer to /preview-as — opening it counts as "I've seen what my clients
// see." show_notes + homework open the notes screen, download_app opens the
// QR popup — in each case opening it is the whole point.
const COMPLETE_ON_CTA_CLICK = new Set(['client_view', 'show_notes', 'homework', 'download_app'])

const STEP_ICON: Record<string, LucideIcon> = {
  business_profile: Building2,
  program_package: Package,
  create_client: UserPlus,
  schedule_session: Calendar,
  show_notes: NotebookPen,
  homework: Notebook,
  client_view: Eye,
  intake_form: ClipboardList,
  invite_client: Mail,
  payments: Wallet,
  booking_page: Globe,
  download_app: Smartphone,
  invite_staff: Users,
}

// The checklist is split into two tiers. Tier 1 ("Get set up") is the core
// path to a real client using the app; tier 2 ("Level up") is the value /
// revenue features trainers reach for once they're rolling. Tier is keyed by
// step key (like STEP_ICON) — presentation only, so admin reordering in the
// DB never moves a step between tiers. Unlisted keys default to tier 1.
const STEP_TIER: Record<string, 1 | 2> = {
  business_profile: 1,
  program_package: 1,
  create_client: 1,
  schedule_session: 1,
  show_notes: 1,
  homework: 1,
  client_view: 1,
  intake_form: 1,
  availability: 1,
  invite_client: 1,
  payments: 2,
  booking_page: 2,
  download_app: 2,
  invite_staff: 2,
}

const TIER_META: Record<1 | 2, { title: string; sub: string }> = {
  1: { title: 'Get set up', sub: 'The essentials — get to your first client using the app.' },
  2: { title: 'Level up', sub: 'Get paid, take bookings, and grow once you’re rolling.' },
}

// md grid-rows class per row count, so a tier's 2-column grid flows DOWN the
// left column then down the right (column-flow). Literal class names so
// Tailwind's scanner keeps them. rows = ceil(stepCount / 2).
const MD_GRID_ROWS: Record<number, string> = {
  1: 'md:grid-rows-1', 2: 'md:grid-rows-2', 3: 'md:grid-rows-3',
  4: 'md:grid-rows-4', 5: 'md:grid-rows-5', 6: 'md:grid-rows-6', 7: 'md:grid-rows-7',
}
import { cn } from '@/lib/utils'
import type { OnboardingState, OnboardingStepView } from '@/lib/onboarding/types'
import { PersonalizationWizard, type WizardInitial } from './personalization-wizard'
import { shouldShowWelcome } from '@/lib/onboarding/welcome'

export function OnboardingPanel({ state, branding, impersonating = false }: { state: OnboardingState; branding: WizardInitial; impersonating?: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const resumeRequested = searchParams.get('wizard') === '1'
  const wantsDownload = searchParams.get('download') === '1'
  const [showDownload, setShowDownload] = useState(false)
  const [optedInToTour, setOptedInToTour] = useState(false)
  // Track welcome dismissal locally so we don't flash the modal again before
  // the router refresh round-trip completes.
  const [welcomeDismissedLocal, setWelcomeDismissedLocal] = useState(false)

  const dismissed = !!state.checklistDismissedAt
  const ahaReached = !!state.ahaReachedAt
  const isBackfill = !!state.backfilledAt
  // Never pop the welcome/personalization modal during admin impersonation —
  // the admin just wants the trainer's dashboard, not their first-run wizard.
  // (welcomeDismissedLocal layers this session's dismissal on top of the
  // persisted state the helper reads.)
  const showWelcome = !welcomeDismissedLocal && shouldShowWelcome(state, impersonating)
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

  // Send the trainer to a step's actual page instead of popping a modal —
  // the FAB hint + sidebar pulse dot on the destination guide them through
  // it. download_app is the one exception: it opens the QR popup in place.
  function goToStep(step: { key: string; ctaHref: string }) {
    if (step.key === 'download_app') {
      fetch(`/api/onboarding/steps/${step.key}/complete`, { method: 'POST' })
        .catch(() => {})
        .finally(() => router.refresh())
      setShowDownload(true)
      return
    }
    // Mark the step started so the FAB on the destination advances past it.
    // CTA-click steps (client_view, show_notes) treat opening as completion.
    fetch(`/api/onboarding/steps/${step.key}/start`, { method: 'POST' }).catch(() => {})
    if (COMPLETE_ON_CTA_CLICK.has(step.key)) {
      fetch(`/api/onboarding/steps/${step.key}/complete`, { method: 'POST' }).catch(() => {})
    }
    router.push(step.ctaHref)
  }

  // "Continue setup" / ?wizard=1 from the FAB on another page → jump straight
  // to the next incomplete step's page.
  useEffect(() => {
    if (!resumeRequested || !nextStep) return
    const url = new URL(window.location.href)
    url.searchParams.delete('wizard')
    window.history.replaceState({}, '', url.toString())
    goToStep(nextStep)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeRequested, nextStep])

  // Open the QR download popup when the download_app step's CTA lands here
  // (its ctaHref is /dashboard?download=1, e.g. via the FAB on another page).
  useEffect(() => {
    if (!wantsDownload) return
    setShowDownload(true)
    const url = new URL(window.location.href)
    url.searchParams.delete('download')
    window.history.replaceState({}, '', url.toString())
  }, [wantsDownload])

  // Backfilled trainer who hasn't opted in → show the opt-in banner only.
  // Hide everything else (no checklist, no modal) until they choose.
  if (dismissed || ahaReached) {
    // Even when complete/aha, show a brief celebration if it just happened —
    // for v1 we keep it simple and just hide the panel.
    return null
  }

  if (showWelcome) {
    return (
      <PersonalizationWizard
        initial={branding}
        onComplete={async () => {
          setWelcomeDismissedLocal(true)
          // Finishing the wizard opts them into the tour (so the dashboard
          // checklist + FAB are live) and marks the welcome as seen.
          await Promise.all([
            fetch('/api/onboarding/tour/start', { method: 'POST' }),
            fetch('/api/onboarding/welcome/dismiss', { method: 'POST' }),
          ])
          // Straight from "who are you" into "what do you capture about your
          // clients" — the starter-field step opens on arrival, so they never
          // meet an empty field list. It's skippable, and only auto-opens when
          // they have no fields yet.
          router.push('/settings?tab=forms&setup=fields')
          router.refresh()
        }}
      />
    )
  }

  if (isBackfill && !optedInToTour) {
    return (
      <BackfillBanner
        onTakeTour={async () => {
          setOptedInToTour(true)
          // Persist the opt-in so the FAB / pulsing dots are allowed
          // to surface on subsequent navigations.
          await fetch('/api/onboarding/tour/start', { method: 'POST' })
          if (nextStep) goToStep(nextStep)
          else router.refresh()
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
      {/* The "Get set up" box is styled like the in-page FAB (blue gradient,
          "WHAT TO DO" voice) and is the only onboarding header on the
          dashboard — the floating FAB stays hidden here. */}
      <ChecklistWidget
        steps={state.steps}
        allComplete={allComplete}
        clientAppEnabled={state.clientAppEnabled}
        onOpenStep={(key) => {
          const step = state.steps.find(s => s.key === key)
          if (step) goToStep(step)
        }}
        onDismiss={async () => {
          await fetch('/api/onboarding/checklist/dismiss', { method: 'POST' }).catch(() => {})
          router.refresh()
        }}
      />

      {showDownload && <DownloadAppModal onClose={() => setShowDownload(false)} />}
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
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                aria-label="Play welcome video (placeholder)"
                className="grid place-items-center h-20 w-20 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm ring-2 ring-white/40 text-white transition-all hover:scale-105"
              >
                <Play className="h-9 w-9 ml-1" fill="currentColor" />
              </button>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.16em] bg-white/15 text-white border border-white/30 backdrop-blur-sm">
                Coming soon
              </span>
            </div>
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
            you&apos;ve been losing to admin. We&apos;ve got a quick guided setup that gets you
            ready to invite your first client — most trainers finish it in under 15 minutes.
          </p>

          <div className="mt-6 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => handle('start')}
              disabled={busy !== null}
              className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold px-5 py-3.5 text-sm shadow-md shadow-blue-600/25 hover:shadow-lg hover:shadow-blue-600/35 hover:-translate-y-px active:translate-y-0 transition-all disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {busy === 'start' ? 'One sec…' : 'Got it — take me in'}
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

// ─── Download app modal (QR codes) ───────────────────────────────────────────

// Popup shown by the download_app step. Two QR codes — App Store + Play Store —
// so the trainer can scan straight from their phone. Store URLs are the
// APP_STORE_URL / PLAY_STORE_URL placeholders at the top of this file; swap
// them for the real listings once the apps are live.
function DownloadAppModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-md animate-pm-fade">
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.4)] overflow-hidden animate-pm-pop">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 grid place-items-center h-9 w-9 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-7 pt-7 pb-6 text-center">
          <span className="inline-grid place-items-center h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white mb-3">
            <Smartphone className="h-6 w-6" />
          </span>
          <h2 className="text-xl font-bold text-slate-900">Get PupManager on your phone</h2>
          <p className="text-sm text-slate-500 mt-1.5">
            Scan a code with your phone&apos;s camera to install the app.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <QrTile
              label="iOS"
              icon={<Apple className="h-4 w-4" />}
              url={APP_STORE_URL}
              fg="#0f172a"
            />
            <QrTile
              label="Android"
              icon={<Play className="h-3.5 w-3.5" fill="currentColor" />}
              url={PLAY_STORE_URL}
              fg="#047857"
            />
          </div>

          <p className="mt-5 text-xs text-slate-400">
            No camera handy? You can grab it from the App Store or Google Play any time.
          </p>
        </div>
      </div>
    </div>
  )
}

function QrTile({ label, icon, url, fg }: { label: string; icon: React.ReactNode; url: string; fg: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 hover:border-slate-300 hover:bg-slate-100 transition-colors"
    >
      <div className="rounded-xl bg-white p-2 ring-1 ring-slate-200">
        <QRCodeSVG value={url} size={120} fgColor={fg} level="M" />
      </div>
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        {icon}
        {label}
      </span>
    </a>
  )
}

// ─── Checklist widget ────────────────────────────────────────────────────────

function ChecklistWidget({
  steps, allComplete, onOpenStep, clientAppEnabled, onDismiss,
}: {
  steps: OnboardingStepView[]
  allComplete: boolean
  onOpenStep: (key: string) => void
  clientAppEnabled: boolean
  onDismiss: () => void | Promise<void>
}) {
  const [dismissing, setDismissing] = useState(false)
  // Tailor the tier-1 subtitle to the client-app choice (no "using the app").
  const tier1Meta = clientAppEnabled
    ? TIER_META[1]
    : { title: TIER_META[1].title, sub: 'The essentials to get your business up and running.' }
  return (
    <div className="mb-6 rounded-3xl overflow-hidden bg-white shadow-[0_18px_48px_-16px_rgba(42,157,169,0.55)] ring-1 ring-slate-200/70">
      {/* Brand-teal header (pm-brand tokens, synced with the marketing site). */}
      <div
        className="relative overflow-hidden px-5 sm:px-6 py-5 text-white"
        style={{ backgroundImage: 'linear-gradient(135deg, var(--pm-brand-500), var(--pm-brand-700))' }}
      >
        {/* Soft paw-print texture + a top sheen for depth. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.10] flex items-center justify-end gap-5 pr-2">
          <PawPrint className="h-24 w-24 rotate-12 -translate-y-3" strokeWidth={1.25} />
          <PawPrint className="h-16 w-16 -rotate-6 translate-y-6" strokeWidth={1.25} />
        </div>
        <div aria-hidden className="pointer-events-none absolute -top-16 -left-10 h-40 w-40 rounded-full bg-white/15 blur-2xl" />

        {/* Close — available at any point, finished or not. Dismissing hides
            this card AND the FAB everywhere (getOnboardingFabState treats
            checklistDismissedAt as "done being nudged"); Help → Continue setup
            brings it back, so it's never a one-way door. */}
        <button
          type="button"
          aria-label="Close setup"
          title="Close setup"
          disabled={dismissing}
          onClick={async () => {
            setDismissing(true)
            try { await onDismiss() } finally { setDismissing(false) }
          }}
          className="absolute top-3 right-3 z-10 grid place-items-center h-8 w-8 rounded-full bg-white/15 text-white/90 hover:bg-white/25 hover:text-white transition-colors disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative min-w-0 pr-10">
          <h3 className="font-bold text-[17px] leading-tight tracking-tight">
            {allComplete ? "You're all set up! 🎉" : 'Welcome to PupManager'}
          </h3>
          <p className="text-sm text-white/85 leading-snug mt-1">
            {allComplete
              ? 'Waiting on your first client to register.'
              : 'Below are the key things to get the most out of PupManager — step through them to set it up.'}
          </p>
        </div>
      </div>

      {/* Steps grouped into two tiers. Tier 1 ("Get set up") always shows;
          tier 2 ("Level up") stays hidden until tier 1 is done (every step
          completed or skipped), so first-run stays focused and the value /
          revenue steps land as a fresh goal. The FAB only routes to a tier-2
          step once tier 1 is finished, so the two stay in sync. */}
      {(() => {
        const tier1 = steps.filter(s => (STEP_TIER[s.key] ?? 1) === 1)
        const tier2 = steps.filter(s => (STEP_TIER[s.key] ?? 1) === 2)
        const tier1Done = tier1.every(s => s.status === 'completed' || s.status === 'skipped')
        return (
          <div className="px-3 sm:px-4 py-3 space-y-4">
            <TierSection meta={tier1Meta} tierSteps={tier1} onOpenStep={onOpenStep} />
            {tier2.length > 0 && tier1Done && (
              <TierSection meta={TIER_META[2]} tierSteps={tier2} onOpenStep={onOpenStep} />
            )}
          </div>
        )
      })()}
    </div>
  )
}

function TierSection({ meta, tierSteps, onOpenStep }: {
  meta: { title: string; sub: string }
  tierSteps: OnboardingStepView[]
  onOpenStep: (key: string) => void
}) {
  const done = tierSteps.filter(s => s.status === 'completed').length
  // Column-flow on md+ so the list reads DOWN the left column then down the
  // right (1–5 left, 6–10 right) rather than zig-zagging left-to-right.
  const rowsClass = MD_GRID_ROWS[Math.ceil(tierSteps.length / 2)] ?? 'md:grid-rows-6'
  return (
    <div>
      <div className="flex items-baseline justify-between px-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--pm-brand-700)]">{meta.title}</p>
        <span className="text-[11px] font-medium text-slate-400 tabular-nums">{done}/{tierSteps.length}</span>
      </div>
      <p className="px-2.5 mb-1.5 text-xs text-slate-400">{meta.sub}</p>
      <ul className={cn('grid grid-cols-1 md:grid-cols-2 md:grid-flow-col gap-x-4 gap-y-0.5', rowsClass)}>
        {tierSteps.map(s => <StepRow key={s.key} s={s} onOpenStep={onOpenStep} />)}
      </ul>
    </div>
  )
}

function StepRow({ s, onOpenStep }: { s: OnboardingStepView; onOpenStep: (key: string) => void }) {
  const StepLucide = STEP_ICON[s.key] ?? PawPrint
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenStep(s.key)}
        className={cn(
          'group w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left text-sm transition-colors',
          'hover:bg-[var(--pm-brand-50)]',
        )}
      >
        <StepIcon status={s.status} n={s.order} />
        <StepLucide
          className={cn(
            'h-4 w-4 shrink-0 transition-colors',
            s.status === 'completed' ? 'text-slate-300' : 'text-slate-400 group-hover:text-[var(--pm-brand-600)]',
          )}
          strokeWidth={1.75}
        />
        <span className={cn(
          'flex-1 truncate font-medium',
          s.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-700',
        )}>
          {s.title}
        </span>
        {s.demo && (
          <span
            className="text-[10px] font-medium uppercase tracking-wide text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded-full shrink-0"
            title="Completed with demo data — add your own to make it real"
          >
            Demo data
          </span>
        )}
        {s.status === 'skipped' && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600 shrink-0">Skipped</span>
        )}
        <ChevronRight
          className="h-4 w-4 shrink-0 text-[var(--pm-brand-600)] opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0"
        />
      </button>
    </li>
  )
}

function StepIcon({ status, n }: { status: OnboardingStepView['status']; n: number }) {
  if (status === 'completed') {
    return (
      <span
        className="flex h-6 w-6 items-center justify-center rounded-full text-white shrink-0 shadow-sm"
        style={{ backgroundColor: 'var(--pm-brand-600)' }}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    )
  }
  if (status === 'skipped') {
    return <MinusCircle className="h-6 w-6 text-amber-400 shrink-0" />
  }
  // Pending / in-progress: a white numbered circle with a teal ring + number.
  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[11px] font-bold tabular-nums shrink-0 ring-1"
      style={{ color: 'var(--pm-brand-700)', '--tw-ring-color': 'var(--pm-brand-500)' } as React.CSSProperties}
    >
      {n}
    </span>
  )
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
