'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowRight, AlertTriangle, XCircle } from 'lucide-react'

interface Props {
  status: 'ACTIVE' | 'INACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELLED'
  // Server passes a Date; serialised to client as a string. Accept both so
  // the layout can keep its select { trialEndsAt: true } as-is.
  trialEndsAt: Date | string | null
}

type Tone = 'indigo' | 'rose' | 'red'

interface BannerCopy {
  headline: string
  subtext: string
  cta: string
  tone: Tone
  daysLeft: number | null
}

// Resolves the trainer's billing state into the floating chip's content.
// Single source of truth — keeps the JSX below dumb. Returns null when
// nothing needs nagging (the trainer is on an active paid plan).
function resolveCopy(status: Props['status'], trialEndsAt: Props['trialEndsAt']): BannerCopy | null {
  if (status === 'ACTIVE') return null

  // Normalise — server-rendered layout passes a Date; once the component
  // boots on the client the prop arrives as an ISO string.
  const endsAt = trialEndsAt ? new Date(trialEndsAt) : null
  const daysLeft = endsAt
    ? Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null

  if (status === 'TRIALING' && daysLeft !== null && daysLeft > 0) {
    return {
      headline: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`,
      subtext: 'Free trial — pick a plan to keep going',
      cta: 'Start plan',
      tone: daysLeft <= 3 ? 'rose' : 'indigo',
      daysLeft,
    }
  }
  if (status === 'TRIALING') {
    return {
      headline: 'Trial finished',
      subtext: 'Pick a plan to keep using PupManager',
      cta: 'Pick a plan',
      tone: 'rose',
      daysLeft: 0,
    }
  }
  if (status === 'PAST_DUE') {
    return {
      headline: 'Payment failed',
      subtext: 'Last charge didn\'t go through',
      cta: 'Fix it up',
      tone: 'rose',
      daysLeft: null,
    }
  }
  if (status === 'CANCELLED') {
    return {
      headline: 'Subscription ended',
      subtext: 'Restart your plan when you\'re ready',
      cta: 'Restart',
      tone: 'red',
      daysLeft: null,
    }
  }
  if (status === 'INACTIVE') {
    return {
      headline: 'No active plan',
      subtext: 'Choose a plan to get started',
      cta: 'See plans',
      tone: 'indigo',
      daysLeft: null,
    }
  }
  return null
}

// Floating bottom-right chip. Three tones + a state-aware leading
// visual: a glass day-count circle when the trainer's still trialing,
// or an alert icon when something's gone wrong. Subtle shimmer on the
// indigo variant + a hover lift make it feel less like a nag and more
// like a living surface.
export function TrialBanner({ status, trialEndsAt }: Props) {
  const pathname = usePathname()
  // The banner exists to nudge the trainer toward /signup. When
  // they're already there (or on the success/cancel landings) the chip
  // becomes a redundant link to the page they're standing on, so hide it.
  if (pathname?.startsWith('/billing')) return null

  const copy = resolveCopy(status, trialEndsAt)
  if (!copy) return null

  // Three tones — indigo (relaxed heads-up), rose (warmer urgency,
  // deliberately NOT yellow/amber), red (hard cancellation). Rose
  // gives us a distinct "running out" signal without sliding into
  // the cliché warning-yellow we don't love.
  const toneShell: Record<Tone, string> = {
    indigo: 'bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white animate-pm-trial-shimmer',
    rose:   'bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-500 text-white animate-pm-trial-shimmer',
    red:    'bg-gradient-to-br from-red-600 via-rose-600 to-rose-700 text-white animate-pm-trial-shimmer',
  }

  const toneAvatar: Record<Tone, string> = {
    indigo: 'bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-sm',
    rose:   'bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-sm',
    red:    'bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-sm',
  }

  const toneCta: Record<Tone, string> = {
    indigo: 'bg-white text-indigo-700 hover:bg-white/95 shadow-sm',
    rose:   'bg-white text-rose-700 hover:bg-white/95 shadow-sm',
    red:    'bg-white text-red-700 hover:bg-white/95 shadow-sm',
  }

  const toneSubtext: Record<Tone, string> = {
    indigo: 'text-white/80',
    rose:   'text-white/85',
    red:    'text-white/85',
  }

  // Choose the leading visual: a day-count circle for an in-progress
  // trial (the number is the headline of the message anyway, big and
  // legible at a glance), or an alert icon for the warning states.
  const leading = copy.daysLeft !== null && copy.daysLeft > 0 ? (
    <div className={`shrink-0 grid place-items-center h-10 w-10 rounded-full font-bold text-base tabular-nums ${toneAvatar[copy.tone]}`}>
      {copy.daysLeft}
    </div>
  ) : (
    <div className={`shrink-0 grid place-items-center h-10 w-10 rounded-full ${toneAvatar[copy.tone]}`}>
      {copy.tone === 'red'
        ? <XCircle className="h-5 w-5" />
        : <AlertTriangle className="h-5 w-5" />}
    </div>
  )

  return (
    <Link
      href="/signup"
      aria-label={`${copy.headline}: ${copy.subtext}`}
      className={`group fixed right-2.5 bottom-[5.625rem] md:bottom-2.5 z-30 flex items-center gap-3 px-3 py-2.5 pr-2 rounded-2xl shadow-[0_18px_40px_-12px_rgba(15,23,42,0.35)] max-w-[calc(100%-1.25rem)] transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_50px_-14px_rgba(15,23,42,0.45)] ${toneShell[copy.tone]}`}
    >
      {leading}

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-tight tracking-tight">
          {copy.headline}
        </p>
        <p className={`text-[11px] leading-tight mt-0.5 truncate ${toneSubtext[copy.tone]}`}>
          {copy.subtext}
        </p>
      </div>

      <span
        className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${toneCta[copy.tone]}`}
      >
        {copy.cta}
        <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}
