import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { AppShell } from '@/components/shared/app-shell'
import { getOnboardingFabState } from '@/lib/onboarding/state'
import { IntakeGate } from './intake-gate'
import { PreviewBanner } from './preview-banner'
import { PreviewOnboardingGuide } from './preview-onboarding-guide'

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const clientProfile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    include: {
      user: { select: { name: true, email: true } },
      trainer: { select: { id: true, businessName: true, logoUrl: true, intakeSectionOrder: true, intakeSystemFieldSections: true } },
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
  const allDogs = [
    ...(clientProfile.dog ? [clientProfile.dog] : []),
    ...clientProfile.dogs,
  ]

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
  const coreContact = {
    name: clientProfile.user.name ?? '',
    email: clientProfile.user.email ?? '',
    phone: clientProfile.phone ?? '',
  }
  const missingCoreContact = !coreContact.name.trim() || !coreContact.phone.trim()

  const clientDisplayName = clientProfile.user.name ?? clientProfile.user.email ?? 'Client'

  // Trainer in preview should see the actual app, not the intake gate — the
  // gate would force them through the client's data-entry flow which would
  // write as the client. The banner already telegraphs that this is a view.
  const showIntakeGate = !active.isPreview && (
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

  if (showIntakeGate) {
    // Render the intake form WITHOUT the AppShell — no top nav, no
    // bottom tab bar. The form is a one-time gate, and a half-built
    // navigation around an unfinished profile is just visual noise
    // (and cheats the focus-on-one-task feel of the form). The
    // PreviewBanner is the only chrome that survives because it
    // pertains to the trainer-in-preview, not the client.
    return (
      <>
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
      </>
    )
  }

  // Count unread messages for this client — anything in their thread
  // the trainer (or another sender) wrote that the client hasn't seen
  // yet. Trainer-in-preview gets a 0 because the badge would otherwise
  // show the actual client's pending messages, which isn't useful.
  const unreadMessageCount = active.isPreview
    ? 0
    : await prisma.message.count({
        where: {
          channel: 'TRAINER_CLIENT',
          readAt: null,
          senderId: { not: clientProfile.userId },
          clientId: clientProfile.id,
        },
      })

  return (
    <>
      {banner}
      <AppShell
        role="CLIENT"
        userName={clientDisplayName}
        userEmail={clientProfile.user.email ?? ''}
        trainerLogo={clientProfile.trainer.logoUrl}
        businessName={clientProfile.trainer.businessName}
        clientNavHints={showPreviewOnboarding}
        unreadCounts={{ '/my-messages': unreadMessageCount, '/home': unreadMessageCount }}
      >
        {children}
      </AppShell>
    </>
  )
}
