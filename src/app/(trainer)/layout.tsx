import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { trainerHasAccess } from '@/lib/access'
import { getTrainerContext } from '@/lib/membership'
import { can, type PermissionKey } from '@/lib/permissions'
import { AppShell } from '@/components/shared/app-shell'
import { OnboardingFab } from './onboarding-fab'
import { PaywallFrame } from './paywall-frame'
import { getOnboardingFabState } from '@/lib/onboarding/state'
import { STEP_TO_MENU } from '@/lib/onboarding/path-step'
import { getStreak } from '@/lib/trainer-streak'
import { isPrivateRelayEmail } from '@/lib/auth-emails'

export default async function TrainerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')

  // Email-verification gate. Credentials sign-ups can't reach here unverified
  // (authorize() blocks them), but Apple-native sign-ups mint a session
  // directly and start unverified — their tell is an unverified email with NO
  // linked OAuth Account row (Google/Apple-web sign-ins always create one, so
  // they're unaffected). Hold them on the verify screen until they enter the
  // 6-digit code we emailed. Skipped during admin impersonation so admins can
  // still inspect such an account.
  if (!session.user.impersonatorId) {
    const u = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, emailVerified: true, _count: { select: { accounts: true } } },
    })
    // Apple "Hide My Email" users (native OR web-OAuth — the latter HAS an
    // account row, so the unverified check below misses them) must swap their
    // private-relay address for a real, deliverable one. Hold them on the
    // verify screen in "replace email" mode until they do.
    if (u && isPrivateRelayEmail(u.email)) {
      redirect(`/verify-account?email=${encodeURIComponent(u.email ?? '')}&next=/dashboard&relay=1`)
    }
    if (u && !u.emailVerified && u._count.accounts === 0) {
      redirect(`/verify-account?email=${encodeURIComponent(session.user.email ?? '')}&next=/dashboard`)
    }
  }

  // Hide nav items this trainer can't act on (role + permissions). Owners and
  // managers see everything; staff get a focused menu. Maps each gated nav
  // href to the permission that unlocks it.
  const ctx = await getTrainerContext()
  const NAV_PERMISSION: Record<string, PermissionKey> = {
    '/packages': 'packages.manage',
    '/classes': 'classes.manage',
    '/products': 'products.manage',
    '/templates': 'forms.manage',
    '/achievements': 'achievements.manage',
    '/enquiries': 'enquiries.manage',
    '/messages': 'messages.send',
  }
  const hiddenNavHrefs = ctx
    ? Object.entries(NAV_PERMISSION)
        .filter(([, perm]) => !can(perm, ctx.role, ctx.permissions))
        .map(([href]) => href)
    : []

  // Read logo + business name fresh from DB on every render so settings updates
  // are reflected immediately. The JWT caches these only at sign-in. Also
  // pulls the trial/sub state for the chrome banner.
  const tp = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId ?? '' },
    select: {
      businessName: true,
      logoUrl: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      stripeSubscriptionId: true,
      gracePeriodUntil: true,
    },
  })

  // Hard paywall: no pay, no access. A trainer whose free trial has lapsed
  // without a subscription (or whose subscription has gone) can't use the
  // platform at all — no nav, no chrome. They're bounced to /billing/setup
  // and shown a bare full-screen subscribe screen. The billing pages are
  // exempt from the redirect so they can actually subscribe (and so we don't
  // loop). API routes enforce their own auth and aren't under this layout.
  if (tp && !trainerHasAccess(tp)) {
    const pathname = (await headers()).get('x-pathname') ?? ''
    if (!pathname.startsWith('/billing')) {
      redirect('/billing/setup')
    }
    return <PaywallFrame>{children}</PaywallFrame>
  }

  // While the trainer is exploring with sample data the account already looks
  // set up, so suppress all onboarding nudges (the FAB + the pulsing menu/page
  // dots) — same idea as hiding the dashboard checklist.
  const usingSampleData = session.user.trainerId
    ? (await prisma.clientProfile.count({ where: { trainerId: session.user.trainerId, isSample: true } })) > 0
    : false

  const fabState = session.user.trainerId && !usingSampleData
    ? await getOnboardingFabState(session.user.trainerId)
    : { show: false, nextStep: null, steps: [], totalSteps: 0, allComplete: false }

  // Highlight the sidebar menu item that corresponds to the next-incomplete
  // step — but only after the trainer has completed their current page's
  // step (the AppShell's path-aware gate decides). Falls back to null when
  // onboarding is done — no dot.
  const highlightMenuHref = fabState.show && fabState.nextStep
    ? STEP_TO_MENU[fabState.nextStep.key] ?? null
    : null

  // Pass the keys of every completed step so AppShell can ask "is the
  // trainer's current page step in this list?" before deciding whether
  // to render the pulsing dot.
  const completedStepKeys = fabState.steps
    .filter(s => s.status === 'completed')
    .map(s => s.key)

  // Count messages the trainer hasn't read yet — anything in the
  // TRAINER_CLIENT channel where the trainer isn't the sender. Powers
  // the badge on the Messages nav item. Bounded by clientProfile.trainerId
  // so a trainer never sees counts from another trainer's threads.
  const unreadMessageCount = session.user.trainerId
    ? await prisma.message.count({
        where: {
          channel: 'TRAINER_CLIENT',
          readAt: null,
          senderId: { not: session.user.id },
          client: { trainerId: session.user.trainerId },
        },
      })
    : 0

  // Training-day engagement streak for the always-visible sidebar pill.
  // Recomputed per navigation (this layout is already dynamic).
  let streak: { current: number } | null = null
  if (session.user.trainerId) {
    const u = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { timezone: true },
    })
    const { current } = await getStreak(session.user.trainerId, u?.timezone ?? 'Pacific/Auckland')
    streak = { current }
  }

  return (
    <AppShell
      role="TRAINER"
      streak={streak}
      userName={session.user.name ?? ''}
      userEmail={session.user.email ?? ''}
      trainerLogo={tp?.logoUrl ?? null}
      businessName={tp?.businessName ?? session.user.businessName}
      highlightMenuHref={highlightMenuHref}
      completedStepKeys={completedStepKeys}
      unreadCounts={{ '/messages': unreadMessageCount }}
      unreadTotal={unreadMessageCount}
      hiddenNavHrefs={hiddenNavHrefs}
    >
      {/* Admin impersonation banner — only present when an admin used
          "Log in as trainer". Stays pinned so the way back to admin is
          always one click away. */}
      {session.user.impersonatorId && (
        <div className="sticky top-0 z-40 flex items-center justify-between gap-3 px-4 py-2 bg-amber-500 text-amber-950 text-sm font-medium">
          <span>
            Viewing as <strong>{tp?.businessName ?? session.user.name ?? 'this trainer'}</strong> — admin impersonation
          </span>
          <a
            href="/api/impersonate/stop"
            className="shrink-0 rounded-lg bg-amber-950/90 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-950"
          >
            Exit to admin
          </a>
        </div>
      )}
      {/* Trial / payment-status banner now lives in the dashboard header only
          (see app/(trainer)/dashboard/page.tsx) instead of floating on every
          page. */}
      {/* FAB sits above the page content so when it's a sticky banner it
          appears at the top of <main> rather than way below at the bottom. */}
      {fabState.show && fabState.nextStep && (
        <OnboardingFab
          nextStep={fabState.nextStep}
          steps={fabState.steps}
          totalSteps={fabState.totalSteps}
        />
      )}
      {children}
    </AppShell>
  )
}
