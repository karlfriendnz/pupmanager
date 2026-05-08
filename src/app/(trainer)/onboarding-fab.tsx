'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowRight, Building2, ClipboardList, Notebook, Package, Trophy, Eye, Mail, PawPrint, Calendar, type LucideIcon } from 'lucide-react'

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

// One-line nudge under the step title so the trainer knows exactly what
// "complete" means without having to open the wizard. Keep these short and
// action-first; the panel/modal carries the longer copy.
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

interface Props {
  nextStep: { key: string; title: string; order: number }
  totalSteps: number
}

// Floating "Next up" card shown across trainer pages while onboarding is in
// progress. Hidden on /dashboard since the persistent checklist + modal already
// live there. Click → /dashboard?wizard=1 which the panel honours by auto-
// opening the modal at the next incomplete step.
const FAB_LAST_STEP_KEY = 'pm-fab-last-step'

export function OnboardingFab({ nextStep, totalSteps }: Props) {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  // Briefly true after nextStep.key changes — drives the celebration animation
  // so the trainer's eye is drawn here when a step just completed.
  const [celebrating, setCelebrating] = useState(false)

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  // Detect changes in nextStep.key vs the last value we displayed (stored in
  // sessionStorage so it survives navigation between pages).
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

  const Icon = STEP_ICON[nextStep.key] ?? PawPrint
  const hint = STEP_HINT[nextStep.key]

  return (
    <Link
      href="/dashboard?wizard=1"
      aria-label={`Continue setup: ${nextStep.title}`}
      className={`group fixed top-4 right-4 sm:top-6 sm:right-6 z-40 block w-[300px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-[0_10px_30px_-8px_rgba(37,99,235,0.45)] ring-1 ring-slate-200/70 hover:shadow-[0_16px_40px_-8px_rgba(37,99,235,0.55)] hover:-translate-y-0.5 transition-all overflow-hidden ${celebrating ? 'animate-pm-fab-bounce' : ''}`}
    >
      {/* Instruction lives at the top — that's the bit the trainer needs to
          read to know what to do next. */}
      {hint && (
        <div className="px-4 pt-3 pb-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-600 mb-1">
            What to do
          </p>
          <p className="text-[13px] text-slate-700 leading-snug">
            {hint}
          </p>
        </div>
      )}

      {/* Divider + step row — keeps the navigational affordance (icon, step
          number, arrow) below the instruction. */}
      <div className={`flex items-center gap-3 px-3 py-2.5 ${hint ? 'border-t border-slate-100 bg-slate-50/60' : ''}`}>
        <span
          aria-hidden
          className={`grid place-items-center h-9 w-9 shrink-0 rounded-xl text-white shadow-md ${
            celebrating
              ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-emerald-500/40 animate-pm-fab-flash'
              : 'bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 shadow-blue-600/30'
          }`}
        >
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
            Step {nextStep.order} of {totalSteps}
          </span>
          <span className="block text-sm font-semibold text-slate-900 truncate leading-tight mt-0.5">
            {nextStep.title}
          </span>
        </span>
        <ArrowRight className="h-4 w-4 text-slate-400 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600" />
      </div>
    </Link>
  )
}
