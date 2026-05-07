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

  return (
    <Link
      href="/dashboard?wizard=1"
      aria-label={`Continue setup: ${nextStep.title}`}
      className={`group fixed top-4 right-4 sm:top-6 sm:right-6 z-40 flex items-center gap-3 max-w-[320px] bg-white rounded-2xl pl-2 pr-4 py-2 shadow-[0_10px_30px_-8px_rgba(37,99,235,0.45)] ring-1 ring-slate-200/70 hover:shadow-[0_16px_40px_-8px_rgba(37,99,235,0.55)] hover:-translate-y-0.5 transition-all ${celebrating ? 'animate-pm-fab-bounce' : ''}`}
    >
      <span
        aria-hidden
        className={`grid place-items-center h-11 w-11 shrink-0 rounded-xl text-white shadow-md ${
          celebrating
            ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-emerald-500/40 animate-pm-fab-flash'
            : 'bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 shadow-blue-600/30'
        }`}
      >
        <Icon className="h-5 w-5" strokeWidth={2} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-blue-600">
          Next up · {nextStep.order} of {totalSteps}
        </span>
        <span className="block text-sm font-semibold text-slate-900 truncate leading-tight mt-0.5">
          {nextStep.title}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 text-slate-400 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600" />
    </Link>
  )
}
