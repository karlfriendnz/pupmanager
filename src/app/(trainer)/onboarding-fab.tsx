'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowRight, Building2, ClipboardList, Notebook, Package, Trophy, Eye, Mail, PawPrint, Calendar, CheckCircle2, type LucideIcon } from 'lucide-react'

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

// One-line nudge so the trainer knows exactly what "complete" means
// without having to open the wizard. Keep these short and action-first;
// the panel/modal carries the longer copy.
const STEP_HINT: Record<string, string> = {
  business_profile: 'Drop your business name, contact details and logo into Settings.',
  intake_form: 'Check the intake form and publish it when you\'re happy.',
  session_form: 'Set up the form your clients see after each session.',
  program_package: 'Create your first programme so you can assign sessions.',
  achievements: 'Tweak the starter achievements and publish the ones you like.',
  client_view: 'Take a quick walk through what your clients will see.',
  invite_client: 'Invite your first real client to get the ball rolling.',
  schedule_session: 'Pop a session in the calendar for your client.',
}

// Maps the trainer's current URL to the wizard step that page belongs to.
// First match wins; most specific patterns first. When a match is found
// AND the trainer hasn't yet completed that step, the FAB shows that
// step's content (so they get the right context for the page they're on).
// Falls back to the next-incomplete step otherwise.
const STEP_PATH_MATCH: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /^\/forms\/intake/, key: 'intake_form' },
  { pattern: /^\/forms\/embed/, key: 'intake_form' },
  { pattern: /^\/forms\/session/, key: 'session_form' },
  { pattern: /^\/forms/, key: 'intake_form' },
  { pattern: /^\/packages/, key: 'program_package' },
  { pattern: /^\/achievements/, key: 'achievements' },
  { pattern: /^\/preview-as/, key: 'client_view' },
  { pattern: /^\/clients\/invite/, key: 'invite_client' },
  { pattern: /^\/schedule/, key: 'schedule_session' },
  { pattern: /^\/settings/, key: 'business_profile' },
]

function stepKeyForPath(pathname: string): string | null {
  for (const m of STEP_PATH_MATCH) {
    if (m.pattern.test(pathname)) return m.key
  }
  return null
}

export interface FabStep {
  key: string
  title: string
  order: number
  ctaHref: string
  status: 'pending' | 'in_progress' | 'completed' | 'skipped'
}

interface Props {
  nextStep: FabStep
  steps: FabStep[]
  totalSteps: number
}

const FAB_LAST_STEP_KEY = 'pm-fab-last-step'

// "Continue setup" banner pinned to the top of the trainer content area.
// Hidden on /dashboard since the persistent checklist + modal already live
// there.
//
// Step resolution:
//  - If the current pathname maps to a step (e.g. /forms/intake → intake_form),
//    use THAT step. The FAB then shows the action hint OR a "completed"
//    indicator based on its status, and the link points back to the page
//    they're already on (mostly a confirmation of "yep, this is the right
//    place to be").
//  - Otherwise the FAB falls back to the next-incomplete step and links
//    out to that step's ctaHref.
export function OnboardingFab({ nextStep, steps, totalSteps }: Props) {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [celebrating, setCelebrating] = useState(false)

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const last = sessionStorage.getItem(FAB_LAST_STEP_KEY)
    if (last && last !== nextStep.key) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCelebrating(true)
      const timer = setTimeout(() => setCelebrating(false), 1100)
      sessionStorage.setItem(FAB_LAST_STEP_KEY, nextStep.key)
      return () => clearTimeout(timer)
    }
    sessionStorage.setItem(FAB_LAST_STEP_KEY, nextStep.key)
  }, [nextStep.key])

  if (!mounted) return null
  if (pathname === '/dashboard') return null

  // Resolve which step the FAB should describe. If the trainer is on a
  // page that maps to a step, prefer that one. Otherwise show the
  // next-incomplete step.
  const pathStepKey = stepKeyForPath(pathname)
  const pathStep = pathStepKey ? steps.find(s => s.key === pathStepKey) : null
  const focused = pathStep ?? nextStep

  const Icon = STEP_ICON[focused.key] ?? PawPrint
  const hint = STEP_HINT[focused.key] ?? `Open the wizard to wrap up ${focused.title.toLowerCase()}.`
  const isCompleted = focused.status === 'completed'
  // Link to the focused step's CTA so clicking gets the trainer to the
  // right place — instead of always bouncing through /dashboard?wizard=1.
  const href = focused.ctaHref || '/dashboard?wizard=1'

  return (
    <Link
      href={href}
      aria-label={isCompleted ? `${focused.title} — completed` : `Continue setup: ${focused.title}`}
      className="group sticky top-2.5 z-30 mx-2.5 mt-2.5 mb-2 flex items-center gap-4 px-4 sm:px-6 py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white rounded-2xl shadow-[0_10px_30px_-8px_rgba(99,102,241,0.55)] hover:shadow-[0_16px_40px_-8px_rgba(99,102,241,0.7)] transition-shadow animate-pm-fab-slide"
    >
      {/* Left: instruction OR completed confirmation. */}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/70 leading-none">
          {isCompleted ? 'Step done' : 'What to do'}
        </p>
        <p className="text-sm text-white leading-snug mt-1.5 line-clamp-2">
          {isCompleted
            ? `${focused.title} is complete — nice work. ${nextStep.key !== focused.key ? `Next up: ${nextStep.title}.` : ''}`
            : hint}
        </p>
      </div>

      {/* Vertical divider on tablet+desktop only — collapses on phones. */}
      <span className="hidden sm:block self-stretch w-px bg-white/25" aria-hidden />

      {/* Right: step icon + counter + arrow. When completed, swap the icon
          tile to an emerald check. */}
      <div className="flex items-center gap-2.5 sm:gap-3 flex-shrink-0">
        <span
          aria-hidden
          className={`grid place-items-center h-9 w-9 shrink-0 rounded-xl text-white ${
            isCompleted
              ? 'bg-emerald-500 ring-1 ring-emerald-300/40'
              : celebrating
                ? 'bg-emerald-500 shadow-emerald-500/40 animate-pm-fab-flash'
                : 'bg-white/15 backdrop-blur-sm ring-1 ring-white/20'
          }`}
        >
          {isCompleted
            ? <CheckCircle2 className="h-4 w-4" strokeWidth={2.25} />
            : <Icon className="h-4 w-4" strokeWidth={2} />}
        </span>
        <div className="hidden sm:flex flex-col min-w-0 max-w-[180px] md:max-w-[220px]">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/70 leading-none">
            Step {focused.order} of {totalSteps}
          </span>
          <span className="text-sm font-semibold text-white truncate leading-tight mt-0.5">
            {focused.title}
          </span>
        </div>
        <ArrowRight className="h-4 w-4 text-white/80 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
      </div>
    </Link>
  )
}
