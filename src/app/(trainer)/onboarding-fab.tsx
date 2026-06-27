'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { CheckCircle2, PawPrint } from 'lucide-react'
import { stepKeyForLocation, STEP_TO_MENU } from '@/lib/onboarding/path-step'

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
// Exported so the dashboard's header banner (OnboardingPanel) can show the
// same next-step hint the FAB shows on every other page.
export const STEP_HINT: Record<string, string> = {
  availability: "Let PupManager know when you train. Click 'Schedule' on the left, then 'Hours'.",
  business_profile: "Let's set up your business — click 'Settings' on the left to add your name and logo.",
  intake_form: "Click 'Settings' on the left, then the 'Forms' tab, to customise the form new clients fill in.",
  program_package: "Time to add a programme. Click 'Packages' on the left to create your first one.",
  create_client: "Add a test client to play with. Click 'Clients' on the left, then 'Add a client'.",
  client_view: "See what your clients see — click 'Clients' on the left, then 'View as client'.",
  show_notes: "Take a peek at where you write session notes — click 'Schedule' on the left and open a session.",
  homework: "Set the dog some homework — open a session from 'Schedule' on the left and add a task.",
  invite_client: "Send your first real client a sign-up link. Click 'Clients' on the left.",
  payments: "Get set up to take payments. Click 'Settings' on the left, then the 'Payments' tab.",
  booking_page: "Let clients book you online. Click 'Website' on the left to make a booking page.",
  invite_staff: "Got a team? Click 'Settings' on the left, then the 'Team' tab, to invite them.",
  download_app: "Grab PupManager on your phone — open the setup card to scan the QR code.",
  schedule_session: "Drop your first session onto the calendar. Click 'Schedule' on the left.",
}

// Hints for trainers on the step's TOP-LEVEL menu page but not yet in the
// sub-screen the step actually lives in (e.g. /schedule with the
// availability modal closed). Steps without a sub-screen use ON_PAGE_HINT
// directly. Checked between subPathHint and ON_PAGE_HINT.
const STEP_ON_MENU_HINT: Record<string, string> = {
  availability: "Tap the 'Hours' button (top of the schedule) to open availability and block out your week.",
}

// On-page hints — used when the trainer is already on the step's primary
// page, so the copy points at the in-page action instead of telling them
// to navigate somewhere they already are. Falls back to STEP_HINT if a
// step has no specific in-page version.
const STEP_ON_PAGE_HINT: Record<string, string> = {
  business_profile: "Fill in your business name, phone and logo here. Hit 'Save' when you're happy.",
  program_package: "Click 'New package' to add your first programme.",
  create_client: "Fill in the name, email and their dog's name, then hit 'Add client' — no email goes out, it's just a test client.",
  schedule_session: "Click any open time slot in the calendar to drop your first session in.",
  show_notes: "This is your notes screen — where you write up each session for your client. Have a go at writing one up.",
  homework: "Open a session and add a homework task or two — your client gets them in their app.",
  client_view: "Click around to see what your clients see. Hit 'Exit preview' when you're done.",
  intake_form: "Have a look through the questions, tweak them, then hit 'Publish' to make the form live.",
  availability: "Pick a day, drag across the hours you can train, then save. Even one day is enough to start.",
  invite_client: "Click 'Create new client' (top right) to add your first client and send their sign-up link.",
  payments: "Click 'Set up payments' and follow the Stripe steps — your details, then a bank account for payouts.",
  booking_page: "Click 'New page' to create a booking page, set its name and link, then turn it live.",
  download_app: "Scan the QR code with your phone's camera to install the app.",
  invite_staff: "Click 'Invite' to send a teammate access — pick their role, then send.",
}

// Sub-path-specific overrides for pages where the trainer is one step
// deeper than the step's primary page (e.g. /clients/invite is the
// invite-form, not the client list). Checked before STEP_ON_PAGE_HINT —
// first matching pattern wins.
const SUB_PATH_HINT: Array<{ pattern: RegExp; hint: string }> = [
  {
    pattern: /^\/clients\/invite/,
    hint: "Fill in your client's name, email and their dog's name, then hit the button to add them.",
  },
]

function subPathHint(pathname: string): string | null {
  for (const m of SUB_PATH_HINT) {
    if (m.pattern.test(pathname)) return m.hint
  }
  return null
}

// Each message is shown when its step *completes*, pointing at the next step
// in the wizard order. Tier 1 (Get set up) → tier 2 (Level up):
//   business_profile → program_package → create_client → schedule_session →
//   show_notes → homework → client_view → intake_form → availability →
//   invite_client → payments → booking_page → download_app → invite_staff → done
// Keep this chain in lockstep with the step order in prisma/seed.ts.
const STEP_TRANSITION: Record<string, string> = {
  business_profile: "Nice work — your business is all set up! Now let's add your first programme — click 'Packages' on the left.",
  program_package: "Boom — your first programme is in! Now add a test client to build around — click 'Clients' on the left, then 'Add a client'.",
  create_client: "Great — your test client's in! Now drop a first session onto the calendar. Click 'Schedule' on the left and pick an open slot.",
  schedule_session: "Booked — your first session is on the calendar! Now have a go at writing it up — open the session and add your notes.",
  show_notes: "Nice — that's how you write up a session! Now set the dog some homework to practise. Add a task or two to the session.",
  homework: "Homework sent! Now take a peek at what your clients see. Click 'Clients' on the left, then 'View as client'.",
  client_view: "Cool — you've seen the client side! Now customise your intake form. Click 'Settings' on the left, then 'Forms'.",
  intake_form: "Your intake form's ready! Now let's block out when you train. Click 'Schedule' on the left, then 'Hours'.",
  availability: "Nice — your hours are blocked out! Now for the big one: invite your first real client. Click 'Clients' on the left.",
  invite_client: "Done — your first invite is on its way! Now let's get you paid — set up payments so clients can pay you. Click 'Settings' on the left, then 'Payments'.",
  payments: "Payments are live — clients can pay you now! Next, make a booking page so they can book you online. Click 'Website' on the left.",
  booking_page: "Your booking page is ready to share! Now grab PupManager on your phone — open the setup card to scan the QR code.",
  download_app: "App installed! Last thing — got a team? Click 'Settings' on the left, then 'Team', to invite them.",
  invite_staff: "That's everything — you're all set up 🎉",
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
  // Hide on the billing surfaces — the trainer's there to deal with
  // payment, not to be nudged into onboarding chores. The trial-status
  // chip + the page itself are already telegraphing what to do here.
  if (pathname?.startsWith('/billing')) return null

  // Resolve the onboarding step this page belongs to.
  const locationKey = `${pathname}${tab ? `?tab=${tab}` : ''}${hash}`
  const pathStepKey = stepKeyForLocation(locationKey)
  const pathStep = pathStepKey ? steps.find(s => s.key === pathStepKey) : null

  // Only show the FAB on pages that ARE a setup step — otherwise the trainer
  // is on an unrelated page (Library, Products, Messages…) and a hint about
  // some other step is just noise. The dashboard "Get set up" box is the
  // catch-all nudge; here we only help with the step you're actually on.
  // And once that step is done, drop the FAB — it's a "what's left" helper,
  // not a badge that lingers on every page you've already finished.
  if (!pathStep || pathStep.status === 'completed') return null

  // Show the hint for THIS page's step (no clamping to the earliest-incomplete
  // step — when a trainer taps a checklist item we navigate straight here).
  const leftStep = pathStep
  const leftCompleted = leftStep.status === 'completed'
  // Hint resolution priority:
  //   1. Sub-path override (e.g. /clients/invite — fills the in-page form)
  //   2. On-page hint (trainer is on the focused step's primary page)
  //   3. Navigational hint (off-page; tells them which menu to click)
  const onPage = !!pathStep && pathStep.key === leftStep.key
  // Trainer is on the step's menu page (e.g. /schedule for availability)
  // but hasn't drilled into the sub-screen yet (e.g. clicked the Hours
  // button). Use a hint that nudges them at the in-page button.
  const onMenu = !onPage && STEP_TO_MENU[leftStep.key] === pathname
  const leftHint = subPathHint(pathname)
    ?? (onPage ? STEP_ON_PAGE_HINT[leftStep.key] : null)
    ?? (onMenu ? STEP_ON_MENU_HINT[leftStep.key] : null)
    ?? STEP_HINT[leftStep.key]
    ?? `Wrap up ${leftStep.title.toLowerCase()}.`

  // The FAB now only appears on its own step's page, so the link just keeps
  // the trainer on that step's primary surface (e.g. the schedule's Hours
  // view). The in-page action is what matters; the hint tells them what to do.
  const href = leftStep.ctaHref || '/dashboard'

  return (
    <Link
      href={href}
      aria-label={leftStep.title}
      style={{ backgroundImage: 'linear-gradient(135deg, var(--pm-brand-500), var(--pm-brand-700))' }}
      className="group relative overflow-hidden sticky top-2.5 z-30 mx-2.5 mt-2.5 mb-2 flex items-center gap-3 px-4 sm:px-5 py-3 text-white rounded-2xl shadow-[0_10px_30px_-8px_rgba(42,157,169,0.55)] hover:shadow-[0_16px_40px_-8px_rgba(42,157,169,0.7)] transition-shadow animate-pm-fab-slide"
    >
      {/* Soft paw-print texture + sheen, matching the dashboard header. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.10] flex items-center justify-end gap-5 pr-2">
        <PawPrint className="h-20 w-20 rotate-12 -translate-y-2" strokeWidth={1.25} />
        <PawPrint className="h-12 w-12 -rotate-6 translate-y-4" strokeWidth={1.25} />
      </div>
      <div aria-hidden className="pointer-events-none absolute -top-12 -left-8 h-32 w-32 rounded-full bg-white/15 blur-2xl" />

      {/* Single column: status of the focused step, with celebration copy
          when it's just been completed. White check tile sits on the left
          edge when the step is done; absent otherwise. */}
      {leftCompleted && (
        <span
          aria-hidden
          className={`relative grid place-items-center h-9 w-9 shrink-0 rounded-xl bg-white ring-1 ring-white/50 ${celebrating ? 'animate-pm-fab-flash' : ''}`}
          style={{ color: 'var(--pm-brand-700)' }}
        >
          <CheckCircle2 className="h-4 w-4" strokeWidth={2.25} />
        </span>
      )}
      {/* Keyed by the focused step + completion state so React remounts the
          block whenever the FAB transitions to a new task or that task flips
          to "done". The remount re-plays the fade-up animation, giving the
          trainer a visual cue that the next thing has arrived. */}
      <div
        key={`${leftStep.key}:${leftCompleted ? 'done' : 'todo'}`}
        className="relative min-w-0 flex-1 animate-pm-fab-content"
      >
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
