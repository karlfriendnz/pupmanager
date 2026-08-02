import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { trainerHasAccess } from '@/lib/access'
import { getTrainerContext } from '@/lib/membership'
import { can, type PermissionKey } from '@/lib/permissions'
import { getEnabledAddons } from '@/lib/billing'
import { sanitizeNavLabels } from '@/lib/nav-labels'
import type { AddonId } from '@/lib/pricing'
import { AppShell } from '@/components/shared/app-shell'
import { ShieldAlert } from 'lucide-react'
import { BookingConflictProvider } from '@/components/schedule/booking-conflict-dialog'
import { CurrencyProvider } from '@/components/currency-context'
import { OnboardingFab } from './onboarding-fab'
import { PaywallFrame } from './paywall-frame'
import { CompleteProfileFrame } from './complete-profile/frame'
import { getOnboardingFabState } from '@/lib/onboarding/state'
import { STEP_TO_MENU } from '@/lib/onboarding/path-step'
import { getStreak } from '@/lib/trainer-streak'
import { isPrivateRelayEmail } from '@/lib/auth-emails'
import { countUnreadMessages } from '@/lib/unread-messages'
import { getAccountAccess, PROFILE_COOKIE } from '@/lib/account-access'
import { ReviewMount } from '@/components/review/review-mount'

export default async function TrainerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')
  // Access is DERIVED, not read off User.role: a CLIENT-role user who
  // contracts for a business (an accepted TrainerMembership) belongs here too.
  // This is the real gate — the proxy's cookie check is only a routing hint,
  // so a forged pm-profile cookie lands here and gets bounced.
  // Always resolved, not only for the non-TRAINER branch: the shell needs to
  // know whether this person ALSO has a client relationship, so it can offer a
  // way across. One query, already cached per request.
  const accountAccess = await getAccountAccess(session.user.id)
  if (session.user.role !== 'TRAINER' && !accountAccess.hasTrainerAccess) {
    redirect('/home')
  }

  // Ask ONCE, of people who hold both sides. Without the cookie they would land
  // here every time and never learn the other side exists — which is exactly
  // what happened to the trainer who prompted this. Choosing sets the cookie, so
  // this cannot ask twice, and a single-sided account never sees it at all.
  if (accountAccess.isDual && !(await cookies()).get(PROFILE_COOKIE)?.value) {
    redirect('/choose-account')
  }

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
    // Stale session: the cookie is valid but its user no longer exists (e.g. a
    // dev DB reset, or a deleted account). Force a clean re-login via /logout
    // instead of rendering the app and letting every auth'd request 401 with a
    // cryptic "Unauthorised".
    if (!u) redirect('/logout')
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

  // Profile-completion gate. Every business owner must have a real name,
  // business name, and phone before using the app. The credentials signup
  // forms (/register, /signup) collect all three, but social sign-ins
  // (Google/Apple) can't — the provider supplies no business name or phone —
  // so those accounts start with an empty businessName and are held here until
  // they fill it in. This also backfills any legacy account created before the
  // rule, on its next visit. Keyed on the profile the user OWNS, so invited
  // staff (who own no business of their own) are unaffected. The complete-
  // profile route itself is exempt so we don't loop; skipped under admin
  // impersonation so admins can still inspect such an account.
  if (!session.user.impersonatorId) {
    const owned = await prisma.trainerProfile.findUnique({
      where: { userId: session.user.id },
      select: { businessName: true, phone: true, user: { select: { name: true } } },
    })
    if (owned) {
      const incomplete = !owned.user.name?.trim() || !owned.businessName.trim() || !owned.phone?.trim()
      if (incomplete) {
        const pathname = (await headers()).get('x-pathname') ?? ''
        if (!pathname.startsWith('/complete-profile')) redirect('/complete-profile')
        return <CompleteProfileFrame>{children}</CompleteProfileFrame>
      }
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
    '/library': 'forms.manage',
    '/achievements': 'achievements.manage',
    '/enquiries': 'enquiries.manage',
    '/messages': 'messages.send',
    '/email-templates': 'settings.edit',
    '/website': 'settings.edit',
    '/finances': 'billing.view',
    '/timesheets': 'billing.view',
    '/reports': 'billing.view',
  }
  const hiddenNavHrefs = ctx
    ? Object.entries(NAV_PERMISSION)
        .filter(([, perm]) => !can(perm, ctx.role, ctx.permissions))
        .map(([href]) => href)
    : []

  // Add-on-gated nav: rather than HIDE a feature whose add-on is off, we show it
  // DISABLED with a "turn it on in Add-ons" prompt (computed below as
  // addonLockedHrefs). Every add-on is off until the trainer enables it.
  const ADDON_NAV: Record<string, AddonId> = {
    '/marketing': 'marketing',
    '/lead-magnets': 'leadmagnets',
    '/schedule/route': 'routeplanner',
    '/timesheets': 'timesheets',
    '/products': 'shop',
    '/achievements': 'achievements',
    '/events': 'events',
    // Packages stays LOCKED (not hidden) when off: unlike Doggy Daycare its
    // add-on is deliberately visible on the Add-ons tab, so the locked row has
    // somewhere real to point. Asserted in tests/unit/memberships-addon-gate.
    '/memberships': 'memberships',
  }
  const enabledAddons = ctx ? await getEnabledAddons(ctx.companyId) : new Set<string>()
  const addonLockedHrefs = Object.entries(ADDON_NAV)
    .filter(([, addon]) => !enabledAddons.has(addon))
    .map(([href]) => href)

  // Core feature add-ons (Client app / Notes / Classes) are default-on; when a
  // trainer turns one off we HIDE its nav entirely (unlike paid add-ons, which
  // show a locked upsell via addonLockedHrefs).
  // 1:1 is the oldest offering and used to be unconditional — a business that
  // only runs classes or daycare had a menu item they could never use.
  if (!enabledAddons.has('onetoone')) hiddenNavHrefs.push('/packages')
  if (!enabledAddons.has('classes')) hiddenNavHrefs.push('/classes')
  // Casual classes are their own offering type now — gated only by the dropins
  // add-on, independent of Group Classes (a trainer can run casual classes
  // without turning group classes on).
  // Its own switch, nothing else. The menu condition and the page guard have to
  // stay identical — when they drifted, the row showed and then bounced, which is
  // the one thing a menu must never do.
  if (!enabledAddons.has('dropins')) hiddenNavHrefs.push('/casual-classes')
  if (!enabledAddons.has('library')) hiddenNavHrefs.push('/library')
  // Doggy Daycare is HIDDEN rather than locked when the add-on is off. The
  // add-on itself is `hidden` while the feature is finished, so showing a locked
  // "turn it on in Add-ons" row would advertise a feature nobody can enable.
  if (!enabledAddons.has('puppyschool')) hiddenNavHrefs.push('/doggy-daycare')
  // No client app → no client↔trainer messaging.
  // Messaging, not the client app — switching off an inbox must not switch off the
  // whole client-facing app.
  if (!enabledAddons.has('messaging')) hiddenNavHrefs.push('/messages')
  // "Link in bio" is a free, off-by-default add-on — its nav entry only appears
  // once the trainer switches Instagram on (enable-to-reveal).
  if (!enabledAddons.has('instagram')) hiddenNavHrefs.push('/instagram')

  // Organisations this user belongs to (their own + any they're a team member
  // at). Powers the sidebar org switcher when there's more than one.
  const orgs = (await prisma.trainerMembership.findMany({
    where: { userId: session.user.id },
    select: { companyId: true, role: true, company: { select: { businessName: true } } },
    orderBy: { role: 'asc' },
  })).map(m => ({ id: m.companyId, name: m.company.businessName, role: m.role }))

  // Read logo + business name fresh from DB on every render so settings updates
  // are reflected immediately. The JWT caches these only at sign-in. Also
  // pulls the trial/sub state for the chrome banner.
  const tp = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId ?? '' },
    select: {
      businessName: true,
      logoUrl: true,
      iconUrl: true,
      payoutCurrency: true,
      // Their words for their own menu — sanitized on the way out, so a rename
      // that's since been locked or removed quietly reverts to our default.
      navLabels: true,
      // Has this business made a tag yet? The Tags menu row appears only when
      // they have (see below). Read HERE, folded into the profile query the
      // shell already runs on every navigation, rather than as a `tag.count`
      // of its own — Prisma resolves a relation count inside the same
      // statement, so the fact arrives for free. A separate query would have
      // put a round trip on every page load of the app to decide one menu row.
      _count: { select: { tags: true } },
      subscriptionStatus: true,
      trialEndsAt: true,
      stripeSubscriptionId: true,
      gracePeriodUntil: true,
    },
  })

  // No tags, no Tags row. Karl's condition, and the right instinct: the screen
  // manages labels that only exist once something has been labelled, so until
  // then it is a menu item that opens onto an explanation. The place a trainer
  // MEETS the idea is the Tags field on the offering and product editors, and
  // the row at the foot of the Offerings hub — both of which stay put.
  if ((tp?._count.tags ?? 0) === 0) hiddenNavHrefs.push('/offerings/tags')

  // Where the top-bar logo links — the signed-in user's chosen landing page
  // (Settings → Business). Per-user, so staff and owner can differ.
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { landingPage: true },
  })
  const homeHref = me?.landingPage === 'schedule' ? '/schedule' : '/dashboard'

  // The top bar's "+" offers "New sale" only when the instant-sale add-on is on
  // AND this member may raise one. Presentation only — POST
  // /api/trainer/finances/receivables re-checks both.
  const canSell = enabledAddons.has('pos') && !!ctx && can('billing.view', ctx.role, ctx.permissions)

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

  // Count messages the trainer hasn't read yet — powers the badge on the
  // Messages nav item. Scoped to their company's threads (see countUnreadMessages).
  const unreadMessageCount = session.user.trainerId
    ? await countUnreadMessages({ kind: 'trainer', companyId: session.user.trainerId, userId: session.user.id })
    : 0

  // Unread in-app notifications for the Notifications nav badge. Chats are
  // excluded — they have their own Messages badge and don't show in this feed.
  // NULL-safe (see notifications/page.tsx): a bare `not` drops typed-null rows
  // like "Payment received", so the badge under-counted them to zero.
  const unreadNotifications = await prisma.notification.count({
    where: { userId: session.user.id, readAt: null, OR: [{ type: null }, { type: { not: 'NEW_MESSAGE' } }] },
  })

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
    <>
    <AppShell
      role="TRAINER"
      // Karen Backhouse owns Guiding Paws AND is a client of Mersea Mutts. Her
      // role says TRAINER, so she lands on her own business and — until this —
      // had no way across. Access is derived from the rows that exist, never
      // from the role.
      isDualProfile={accountAccess.isDual}
      streak={streak}
      userName={session.user.name ?? ''}
      userEmail={session.user.email ?? ''}
      trainerLogo={tp?.logoUrl ?? null}
      trainerIcon={tp?.iconUrl ?? null}
      businessName={tp?.businessName ?? session.user.businessName}
      homeHref={homeHref}
      highlightMenuHref={highlightMenuHref}
      completedStepKeys={completedStepKeys}
      unreadCounts={{ '/messages': unreadMessageCount, '/notifications': unreadNotifications }}
      unreadTotal={unreadMessageCount + unreadNotifications}
      hiddenNavHrefs={hiddenNavHrefs}
      addonLockedHrefs={addonLockedHrefs}
      navLabels={sanitizeNavLabels(tp?.navLabels)}
      canSell={canSell}
      currency={tp?.payoutCurrency ?? 'nzd'}
      orgs={orgs}
      activeCompanyId={session.user.trainerId ?? null}
    >
      {/* Admin impersonation marker — a small pill pinned bottom-right (out of
          the way of the page chrome) that exits back to admin on click. */}
      {session.user.impersonatorId && (
        <a
          href="/api/impersonate/stop"
          title={`Viewing as ${tp?.businessName ?? session.user.name ?? 'this trainer'} — click to exit to admin`}
          className="impersonate-fab inline-flex items-center gap-2 rounded-full bg-amber-500 px-3.5 py-2.5 text-xs font-semibold text-amber-950 shadow-lg ring-1 ring-black/10 transition-colors hover:bg-amber-400"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>Admin impersonate</span>
          <span className="text-amber-900/70">· Exit</span>
        </a>
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
      <CurrencyProvider currency={tp?.payoutCurrency ?? 'nzd'}>
        <BookingConflictProvider>{children}</BookingConflictProvider>
      </CurrencyProvider>
    </AppShell>
    {/* Dev only — renders nothing in production. */}
    <ReviewMount />
    </>
  )
}
