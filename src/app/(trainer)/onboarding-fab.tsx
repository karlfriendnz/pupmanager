'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { stepKeyForLocation } from '@/lib/onboarding/path-step'

// Conversational copy for the LEFT side of the FAB. Two flavours:
//
//  STEP_HINT (incomplete) — "here's what to do, told plainly". Points at the
//  menu item they need to click. Pairs with the pulsing dot AppShell renders
//  beside the matching menu item so the trainer actually learns the layout
//  instead of being teleported by FAB clicks.
//
//  STEP_TRANSITION (just completed) — "nice work + here's what's next, no
//  pressure". Friendlier mentor tone; mentions that optional steps can be
//  done later.
const STEP_HINT: Record<string, string> = {
  business_profile: "Let's set up your business — click 'Settings' on the left to add your name and logo.",
  intake_form: "Click 'Settings' on the left, then the 'Forms' tab, to set up the form new clients fill in.",
  session_form: "Click 'Settings' on the left, then 'Forms', to set up the form for after each session.",
  program_package: "Time to add a programme. Click 'Packages' on the left to create your first one.",
  achievements: "Pick the badges your clients can earn. Click 'Achievements' on the left.",
  client_view: "See what your clients see — click 'Clients' on the left, then 'View as client'.",
  invite_client: "Send your first real client a sign-up link. Click 'Clients' on the left.",
  schedule_session: "Book your first session. Click 'Schedule' on the left.",
}

// On-page hints — used when the trainer is already on the step's primary
// page, so the copy points at the in-page action instead of telling them
// to navigate somewhere they already are. Falls back to STEP_HINT if a
// step has no specific in-page version.
const STEP_ON_PAGE_HINT: Record<string, string> = {
  business_profile: "Fill in your business name, phone and logo here. Hit 'Save' when you're happy.",
  intake_form: "Have a look through the questions, then hit 'Publish' to make the form live.",
  session_form: "Have a look through the questions, then hit 'Publish' to make the form live.",
  program_package: "Click 'New package' to add your first programme.",
  achievements: "Pick the achievements you'd like your clients to earn — tap any to publish.",
  client_view: "Click around to see what your clients see. Hit 'Exit preview' when you're done.",
  invite_client: "Click 'Invite client' (top right) to send your first sign-up link.",
  schedule_session: "Click any open time slot in the calendar to book a session.",
}

const STEP_TRANSITION: Record<string, string> = {
  business_profile: "Nice work — your business is all set up! Now let's get your intake form ready. Click 'Settings' on the left, then 'Forms'.",
  intake_form: "Awesome — your intake form is ready! You can do the other forms later. Now let's add your first programme — click 'Packages' on the left.",
  session_form: "Sweet — your session form is set! Now let's add your first programme. Click 'Packages' on the left.",
  program_package: "Boom — your first programme is in! Now let's pick some fun achievements. Click 'Achievements' on the left.",
  achievements: "Nice — your achievements are live! Time to invite your first real client. Click 'Clients' on the left.",
  invite_client: "Done — your first invite is on its way! Now let's book a session. Click 'Schedule' on the left.",
  schedule_session: "Booked — your first session is on the calendar! Last step: take a quick peek at what your clients will see. Click 'Clients' on the left, then 'View as client'.",
  client_view: "Cool — you've seen what your clients see! That's the basics done. You're all set up 🎉",
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
  const searchParams = useSearchParams()
  const tab = searchParams?.get('tab') ?? ''
  const [mounted, setMounted] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  // usePathname / useSearchParams handle the path + query, but the hash
  // (#tab markers in older links) doesn't trigger Next.js navigation
  // events, so we wire that listener ourselves.
  const [hash, setHash] = useState('')

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setHash(window.location.hash)
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [pathname])

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

  // Resolve the focused step from the trainer's current URL — the FAB
  // describes that step's status. When no path matches, fall back to the
  // next-incomplete step.
  const locationKey = `${pathname}${tab ? `?tab=${tab}` : ''}${hash}`
  const pathStepKey = stepKeyForLocation(locationKey)
  const pathStep = pathStepKey ? steps.find(s => s.key === pathStepKey) : null
  const leftStep = pathStep ?? nextStep
  const leftCompleted = leftStep.status === 'completed'
  // When the trainer is already on the step's page, prefer the in-page
  // hint ("click 'Invite client'") over the navigational one ("click
  // 'Clients' on the left") which is awkward when they're already there.
  const leftHint = (pathStep ? STEP_ON_PAGE_HINT[pathStep.key] : null)
    ?? STEP_HINT[leftStep.key]
    ?? `Wrap up ${leftStep.title.toLowerCase()}.`

  // Click is a fallback for trainers who'd rather skip the menu — points
  // at the next-incomplete step. The pulsing dot on the sidebar is the
  // primary affordance now, since the goal is to teach navigation.
  const href = nextStep.ctaHref || '/dashboard?wizard=1'

  return (
    <Link
      href={href}
      aria-label={`Next: ${nextStep.title}`}
      className="group sticky top-2.5 z-30 mx-2.5 mt-2.5 mb-2 flex items-center gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white rounded-2xl shadow-[0_10px_30px_-8px_rgba(99,102,241,0.55)] hover:shadow-[0_16px_40px_-8px_rgba(99,102,241,0.7)] transition-shadow animate-pm-fab-slide"
    >
      {/* Single column: status of the focused step, with celebration copy
          when it's just been completed. Green check tile sits on the left
          edge when the step is done; absent otherwise. */}
      {leftCompleted && (
        <span
          aria-hidden
          className={`grid place-items-center h-9 w-9 shrink-0 rounded-xl bg-emerald-500 text-white ring-1 ring-emerald-300/40 ${celebrating ? 'animate-pm-fab-flash' : ''}`}
        >
          <CheckCircle2 className="h-4 w-4" strokeWidth={2.25} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/70 leading-none">
          {leftCompleted ? 'Step done 🎉' : 'What to do'}
        </p>
        <p className="text-sm text-white leading-snug mt-1.5 line-clamp-3">
          {leftCompleted
            ? STEP_TRANSITION[leftStep.key] ?? `${leftStep.title} is complete — nice work.`
            : leftHint}
        </p>
      </div>
    </Link>
  )
}
