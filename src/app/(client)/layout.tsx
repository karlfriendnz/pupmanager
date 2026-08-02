import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveClient, noActiveClientDestination } from '@/lib/client-context'
import { CurrencyProvider } from '@/components/currency-context'
import { sanitizeNavLabels } from '@/lib/nav-labels'
import { AppShell } from '@/components/shared/app-shell'
import { getOnboardingFabState } from '@/lib/onboarding/state'
import { countClientUnreadTotal } from '@/lib/client-message-threads'
import { getEnabledAddons } from '@/lib/billing'
import { DEFAULT_BRAND_COLOR } from '@/lib/brand'
import { mergeClientDogs } from '@/lib/dogs'
import { IntakeGate } from './intake-gate'
import { FormIntakeGate } from './form-intake-gate'
import { renderUnifiedForm } from '@/lib/unified-form-render'
import { PreviewBanner, PREVIEW_SHELL_CLASS } from './preview-banner'
import { PreviewProvider } from './preview-context'
import { PreviewOnboardingGuide } from './preview-onboarding-guide'
import { ReviewMount } from '@/components/review/review-mount'

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const active = await getActiveClient()
  // Redirect TARGET only — the gate itself is unchanged. A dog owner who signed
  // themselves up has an account but no ClientProfile until a trainer accepts
  // them, and sending them to /login was an infinite bounce.
  if (!active) redirect(await noActiveClientDestination())

  // Does this person also run a business? If so the shell offers a way back to
  // it. `actualUserId` rather than the profile's userId: when a trainer is
  // PREVIEWING a client, the person holding the session is the trainer, and the
  // switch must never be offered as though it were the client's own.
  const { getAccountAccess, PROFILE_COOKIE } = await import('@/lib/account-access')
  const accountAccess = await getAccountAccess(active.actualUserId)

  // The same one-time question as the trainer side, for a dual account that
  // happens to land here first. Skipped during a PREVIEW: the trainer is
  // borrowing a client's view, and asking them to choose an account mid-preview
  // would be nonsense — and would bounce them out of the thing they opened.
  if (accountAccess.isDual && !active.isPreview) {
    const { cookies: readCookies } = await import('next/headers')
    if (!(await readCookies()).get(PROFILE_COOKIE)?.value) redirect('/choose-account')
  }

  const clientProfile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    include: {
      user: { select: { name: true, email: true } },
      trainer: { select: { id: true, businessName: true, navLabels: true, logoUrl: true, emailAccentColor: true, phone: true, showPhoneToClients: true, website: true, publicEmail: true, payoutCurrency: true, intakeSectionOrder: true, intakeSystemFieldSections: true } },
      dog: { select: { id: true, name: true } },
      dogs: { select: { id: true, name: true } },
      customFieldValues: { select: { fieldId: true, dogId: true, value: true } },
    },
  })

  if (!clientProfile) redirect('/login')

  // Fetch all custom fields defined by this trainer
  const customFields = await prisma.customField.findMany({
    where: { trainerId: clientProfile.trainer.id },
    orderBy: { order: 'asc' },
  })

  // Check if any required fields are missing values
  const allDogs = mergeClientDogs(clientProfile.dog, clientProfile.dogs)

  const existingValues = Object.fromEntries(
    clientProfile.customFieldValues.map(v => [
      v.dogId ? `${v.fieldId}:${v.dogId}` : v.fieldId,
      v.value,
    ])
  )

  let hasMissingRequired = false
  for (const field of customFields) {
    if (!field.required) continue
    if (field.appliesTo === 'OWNER') {
      if (!existingValues[field.id]?.trim()) { hasMissingRequired = true; break }
    } else {
      // DOG field — check each dog
      for (const dog of allDogs) {
        if (!existingValues[`${field.id}:${dog.id}`]?.trim()) { hasMissingRequired = true; break }
      }
      if (hasMissingRequired) break
    }
  }

  // Core contact details are also required on intake. Email is always
  // present (the client signed in with it), but name + phone may be
  // empty for clients who joined via magic link. Trip the gate when
  // either is missing, even if the trainer hasn't defined any custom
  // fields — we still need name + phone before the trainer can do
  // their job.
  //
  // Name and email come from the login, so they're already filled in for
  // someone who has used the app before. The phone lives on the client record,
  // which is PER TRAINER — so a dog owner taking on a second trainer met a
  // blank phone box and had to retype a number we already hold. Offer their
  // existing one as the starting value; they still confirm it, and each
  // trainer still keeps their own copy, so a client who wants to give one
  // trainer a different number can just change it.
  const phoneFromAnotherTrainer = clientProfile.phone
    ? null
    : (await prisma.clientProfile.findFirst({
        where: { userId: clientProfile.userId, phone: { not: null }, id: { not: clientProfile.id } },
        orderBy: { updatedAt: 'desc' },
        select: { phone: true },
      }))?.phone ?? null

  const coreContact = {
    name: clientProfile.user.name ?? '',
    email: clientProfile.user.email ?? '',
    phone: clientProfile.phone ?? phoneFromAnotherTrainer ?? '',
  }
  // The gate still trips on a phone we've only *suggested* — it isn't saved
  // against this trainer until they submit it.
  const missingCoreContact = !coreContact.name.trim() || !clientProfile.phone?.trim()

  const clientDisplayName = clientProfile.user.name ?? clientProfile.user.email ?? 'Client'

  // Trainer in preview should see the actual app, not the intake gate — the
  // gate would force them through the client's data-entry flow which would
  // write as the client. The banner already telegraphs that this is a view.
  //
  // …except on the trainer switcher. The gate replaces the entire app, so
  // someone who has just been added by a NEW trainer — which makes that
  // relationship the active one — would otherwise be trapped in that trainer's
  // intake with no way back to the trainer they already use. The switcher is
  // always reachable.
  const pathname = (await headers()).get('x-pathname') ?? ''
  const onSwitcher = pathname.startsWith('/switch-trainer')

  const showIntakeGate = !active.isPreview && !onSwitcher && (
    missingCoreContact || (hasMissingRequired && customFields.length > 0)
  )

  // Trainer-in-preview gets the onboarding guide + indigo nav-dot
  // highlighting only while their wizard is incomplete. Real clients (no
  // preview cookie) never see any of this.
  let showPreviewOnboarding = false
  if (active.isPreview) {
    const session = await auth()
    if (session?.user?.role === 'TRAINER' && session.user.trainerId) {
      const fab = await getOnboardingFabState(session.user.trainerId)
      showPreviewOnboarding = fab.show
    }
  }

  const banner = active.isPreview
    ? (
      <>
        <PreviewBanner clientName={clientDisplayName} />
        {showPreviewOnboarding && <PreviewOnboardingGuide />}
      </>
    )
    : null

  // ── The assigned client form comes first ──────────────────────────────────
  // If this client was sent a client form when they were invited, that is what
  // their trainer wants asked — so it takes priority over the field-library
  // gate below. Same exemptions: a trainer in preview, and the trainer
  // switcher, which must always stay reachable.
  const showFormGate =
    !active.isPreview && !onSwitcher &&
    !!clientProfile.intakeFormId && !clientProfile.intakeCompletedAt

  if (showFormGate) {
    const assigned = await prisma.form.findFirst({
      // Scoped to the client's own trainer: a form reassigned across tenants,
      // or a stale id, must not render another business's questions.
      where: { id: clientProfile.intakeFormId!, trainerId: clientProfile.trainer.id },
      select: { id: true, trainerId: true, name: true, description: true, questions: true, steps: true },
    })
    // A deleted form leaves intakeFormId dangling (the FK is SetNull, but a
    // race can still land here). Falling through to the field gate is the
    // right failure: never lock a client out of their own app.
    if (assigned) {
      const { runnable, linkedFields } = await renderUnifiedForm(assigned)
      const brand = clientProfile.trainer.emailAccentColor ?? DEFAULT_BRAND_COLOR
      return (
        <div style={{ ['--accent' as string]: brand } as React.CSSProperties}>
          <FormIntakeGate
            businessName={clientProfile.trainer.businessName}
            trainerLogoUrl={clientProfile.trainer.logoUrl}
            form={runnable}
            linkedFields={linkedFields}
          />
        </div>
      )
    }
  }

  if (showIntakeGate) {
    // Render the intake form WITHOUT the AppShell — no top nav, no
    // bottom tab bar. The form is a one-time gate, and a half-built
    // navigation around an unfinished profile is just visual noise
    // (and cheats the focus-on-one-task feel of the form). The
    // PreviewBanner is the only chrome that survives because it
    // pertains to the trainer-in-preview, not the client.
    return (
      <div className={active.isPreview ? PREVIEW_SHELL_CLASS : undefined}>
        {banner}
        <IntakeGate
          businessName={clientProfile.trainer.businessName}
          trainerLogoUrl={clientProfile.trainer.logoUrl}
          customFields={customFields.map(f => ({
            id: f.id,
            label: f.label,
            type: f.type as 'TEXT' | 'NUMBER' | 'DROPDOWN',
            required: f.required,
            options: Array.isArray(f.options) ? f.options as string[] : [],
            category: f.category,
            appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
          }))}
          // Normalise the JSON column — handles both legacy string[] and new
          // {name, description?}[] shapes.
          sectionMeta={(Array.isArray(clientProfile.trainer.intakeSectionOrder)
            ? clientProfile.trainer.intakeSectionOrder
            : []
          ).map(entry =>
            typeof entry === 'string'
              ? { name: entry, description: null }
              : { name: (entry as { name: string }).name, description: (entry as { description?: string | null }).description ?? null }
          )}
          dogs={allDogs}
          existingValues={existingValues}
          coreContact={coreContact}
          systemFieldSections={
            (clientProfile.trainer.intakeSystemFieldSections as Partial<Record<'name' | 'email' | 'phone', string | null>> | null) ?? {}
          }
        />
      </div>
    )
  }

  // Count unread messages for this client — anything the trainer (or another
  // sender) wrote that they haven't seen yet, across their 1:1 thread AND the
  // groups this same business put them in. Scoped to the ACTIVE business, so a
  // group at another trainer never shows up on this badge. Trainer-in-preview
  // gets a 0 (the badge would otherwise show the real client's pending messages).
  const unreadMessageCount = active.isPreview
    ? 0
    : await countClientUnreadTotal({
        clientId: clientProfile.id,
        userId: clientProfile.userId,
        trainerId: clientProfile.trainer.id,
      })

  // Per-trainer brand colour. A single solid colour drives --accent (and
  // re-derives the soft/tint/surface shades on this wrapper so they follow the
  // brand colour rather than the :root teal). --accent-strong is set to the SAME
  // colour so any `linear-gradient(--accent, --accent-strong)` renders solid.
  const t = clientProfile.trainer
  const brand = t.emailAccentColor ?? DEFAULT_BRAND_COLOR
  const themeStyle = {
    ['--accent' as string]: brand,
    ['--accent-strong' as string]: brand,
    ['--accent-soft' as string]: 'color-mix(in srgb, var(--accent) 14%, white)',
    ['--accent-tint' as string]: 'color-mix(in srgb, var(--accent) 7%, white)',
    ['--surface' as string]: 'color-mix(in srgb, var(--accent) 4%, #f7fafb)',
  } as React.CSSProperties

  // Does this user work with more than one trainer? Drives the "Switch
  // trainer" entry in the menu/sidebar. Skipped in preview (trainer-as-client).
  const trainerCount = active.isPreview
    ? 1
    : await prisma.clientProfile.count({ where: { userId: clientProfile.userId } })

  // The client shop is a trainer add-on — hide the Shop nav item (and the home
  // shop shortcut) when the trainer hasn't enabled it.
  // Asked once, since two gates read it.
  const trainerAddons = await getEnabledAddons(clientProfile.trainer.id)
  const shopEnabled = trainerAddons.has('shop')
  // Achievements is a trainer add-on too, and its nav entry was never gated — so a
  // client of a business with achievements switched off still had the menu item and
  // the home section, showing badges their trainer had turned off.
  // (Karl, 2026-07-30.)
  const achievementsEnabled = trainerAddons.has('achievements')

  // Build the hidden-nav list from the gates above.
  const hiddenClientNav: string[] = []
  if (!shopEnabled) hiddenClientNav.push('/my-shop')
  if (!achievementsEnabled) hiddenClientNav.push('/my-achievements')
  // Memberships live INSIDE Offerings now (a type in the booking flow), so they
  // no longer get their own nav entry. The page + buy route stay put — it's the
  // Stripe cancel/return target and still works as a direct link.
  hiddenClientNav.push('/my-memberships')

  return (
    // In preview the amber banner is a fixed bar. PREVIEW_SHELL_CLASS carries
    // the stylesheet that pushes the shell (and its pinned header/sidebar) down
    // by exactly the banner's height, so nothing sits behind it.
    //
    // This used to bump --app-safe-top by 2.75rem instead. It did nothing: the
    // CLIENT shell never reads that variable (only the trainer shell does), the
    // banner measured 61px rather than 44px, and the bar it was compensating
    // for was sticky, not fixed. Three ways wrong, so all three are gone.
    <div className={active.isPreview ? PREVIEW_SHELL_CLASS : undefined} style={themeStyle}>
      {banner}
      <AppShell
        role="CLIENT"
        isDualProfile={accountAccess.isDual}
        userName={clientDisplayName}
        userEmail={clientProfile.user.email ?? ''}
        trainerLogo={clientProfile.trainer.logoUrl}
        businessName={clientProfile.trainer.businessName}
        trainerContact={{
          // Only expose the trainer's phone to clients when they've opted in.
          phone: clientProfile.trainer.showPhoneToClients ? clientProfile.trainer.phone : null,
          website: clientProfile.trainer.website,
          email: clientProfile.trainer.publicEmail,
        }}
        navLabels={sanitizeNavLabels(clientProfile.trainer.navLabels)}
        showTrainerSwitcher={trainerCount > 1}
        clientNavHints={showPreviewOnboarding}
        unreadCounts={{ '/my-messages': unreadMessageCount, '/home': unreadMessageCount }}
        unreadTotal={unreadMessageCount}
        hiddenNavHrefs={hiddenClientNav.length ? hiddenClientNav : undefined}
      >
        <PreviewProvider value={active.isPreview}>
          <CurrencyProvider currency={clientProfile.trainer.payoutCurrency ?? 'nzd'}>
            {children}
          </CurrencyProvider>
        </PreviewProvider>
      </AppShell>
      {/* Dev only — renders nothing in production. */}
      <ReviewMount />
    </div>
  )
}
