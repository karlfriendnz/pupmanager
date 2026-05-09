import Link from 'next/link'
import { Sparkles } from 'lucide-react'

interface Props {
  status: 'ACTIVE' | 'INACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELLED'
  trialEndsAt: Date | null
}

// Thin chrome banner showing trial state. Three modes:
//   - active paid sub  → null (banner hidden)
//   - trialing         → "X days left in your trial — Start plan →"
//   - past_due         → amber "Your last payment didn't go through"
//   - cancelled        → red "Your subscription has ended"
//
// Server component; renders inert text + a normal <Link>, so it works
// in both web and Capacitor without needing a client hook. The link
// lands on /billing/plans where the per-plan CTA handles the
// in-tab-vs-open-Safari decision.
export function TrialBanner({ status, trialEndsAt }: Props) {
  if (status === 'ACTIVE') return null

  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null

  let copy: { label: string; cta: string; tone: 'indigo' | 'amber' | 'red' } | null = null

  if (status === 'TRIALING' && daysLeft !== null && daysLeft > 0) {
    copy = {
      label: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your free trial`,
      cta: 'Start plan',
      tone: daysLeft <= 3 ? 'amber' : 'indigo',
    }
  } else if (status === 'TRIALING') {
    copy = { label: 'Your trial has finished', cta: 'Pick a plan', tone: 'amber' }
  } else if (status === 'PAST_DUE') {
    copy = { label: "Your last payment didn't go through", cta: 'Fix it up', tone: 'amber' }
  } else if (status === 'CANCELLED') {
    copy = { label: 'Your subscription has ended', cta: 'Restart plan', tone: 'red' }
  } else if (status === 'INACTIVE') {
    copy = { label: 'No active plan', cta: 'See plans', tone: 'indigo' }
  }

  if (!copy) return null

  const toneClasses = {
    indigo: 'bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white',
    amber:  'bg-amber-100 text-amber-900 border-b border-amber-200',
    red:    'bg-red-100 text-red-900 border-b border-red-200',
  }[copy.tone]

  const ctaClasses = copy.tone === 'indigo'
    ? 'bg-white/20 hover:bg-white/30 text-white'
    : copy.tone === 'amber'
      ? 'bg-amber-700 hover:bg-amber-800 text-white'
      : 'bg-red-700 hover:bg-red-800 text-white'

  return (
    // Pinned to the bottom of the viewport. On mobile the trainer's
    // bottom tab bar lives at bottom-0 z-40, so we sit at bottom-20
    // (5rem) above it; on desktop the tab bar is gone so we sit
    // flush with the bottom edge. z-30 so app modals at z-50 still
    // come over the top.
    <div className={`fixed inset-x-0 bottom-20 md:bottom-0 z-30 flex items-center justify-between gap-3 px-4 py-2 text-sm shadow-[0_-6px_20px_-12px_rgba(15,23,42,0.25)] ${toneClasses}`}>
      <div className="flex items-center gap-2 min-w-0">
        {copy.tone === 'indigo' && <Sparkles className="h-4 w-4 shrink-0" />}
        <span className="truncate font-medium">{copy.label}</span>
      </div>
      <Link
        href="/billing/plans"
        className={`shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${ctaClasses}`}
      >
        {copy.cta}
      </Link>
    </div>
  )
}
