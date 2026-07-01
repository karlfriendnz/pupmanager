import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { TrainerSettingsForm } from './trainer-settings-form'
import { SettingsTabs } from './settings-tabs'
import { NotificationsPanel } from './notifications-panel'
import { TeamPanel } from './team-panel'
import { BillingPanel } from './billing-panel'
import { DeleteAccountSection } from './delete-account-section'
import { PaymentsPanel } from './payments-panel'
import { ActivityPanel } from './activity-panel'
import { AddonsTab } from './addons-tab'
import { IntegrationTab } from './integration-tab'
import { XeroTab } from './xero-tab'
import { hasAddon } from '@/lib/billing'
import { FormsManager } from '../forms/forms-manager'
import type { Question } from '../forms/session/session-forms-manager'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Settings' }

export default async function TrainerSettingsPage() {
  // Resolve via membership so invited members (who don't own a TrainerProfile)
  // reach their company's settings instead of bouncing to /login.
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')

  const canEditSettings = can('settings.edit', ctx.role, ctx.permissions)
  const canManageForms = can('forms.manage', ctx.role, ctx.permissions)
  // The Xero tab only exists when the (free) Xero add-on is enabled.
  const xeroEnabled = canEditSettings && (await hasAddon(ctx.companyId, 'xero'))

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: { id: true, businessName: true, phone: true, showPhoneToClients: true, signupCountry: true, publicEmail: true, logoUrl: true, dashboardBgUrl: true, inviteTemplate: true, emailAccentColor: true, appGradientStart: true, appGradientEnd: true, intakeSectionOrder: true, intakeFormPublished: true, baseAddress: true, baseLat: true, baseLng: true },
  })

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { name: true, email: true, timezone: true, notifyEmail: true, notifyPush: true },
  })

  if (!user || !trainerProfile) redirect('/login')

  // Forms data is only needed for the Forms tab — skip the queries for members
  // who can't manage forms (the tab won't render for them). Embed (lead-capture)
  // forms now live on the standalone Website page, not here.
  const [customFields, sessionForms] = canManageForms
    ? await Promise.all([
        prisma.customField.findMany({
          where: { trainerId: trainerProfile.id },
          orderBy: { order: 'asc' },
        }),
        prisma.sessionForm.findMany({
          where: { trainerId: trainerProfile.id },
          orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
          include: { _count: { select: { responses: true } } },
        }),
      ])
    : [[], []] as const

  const intakeFields = customFields.map(f => ({
    id: f.id,
    label: f.label,
    type: f.type as 'TEXT' | 'NUMBER' | 'DROPDOWN',
    required: f.required,
    options: Array.isArray(f.options) ? f.options as string[] : [],
    category: f.category ?? null,
    appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
    order: f.order,
  }))

  return (
    <>
      <PageHeader title="Settings" />
      <div className="p-4 md:p-8 w-full">

      <SettingsTabs
        profile={canEditSettings ? (
          <TrainerSettingsForm user={user} profile={trainerProfile} />
        ) : undefined}
        notifications={<NotificationsPanel />}
        integration={can('settings.edit', ctx.role, ctx.permissions) ? <IntegrationTab companyId={ctx.companyId} /> : undefined}
        addons={can('billing.view', ctx.role, ctx.permissions) ? <AddonsTab companyId={ctx.companyId} /> : undefined}
        team={<TeamPanel />}
        payments={ctx.role === 'OWNER' ? <PaymentsPanel companyId={ctx.companyId} /> : undefined}
        xero={xeroEnabled ? <XeroTab companyId={ctx.companyId} /> : undefined}
        billing={ctx.role === 'OWNER' ? (
          <>
            <BillingPanel companyId={ctx.companyId} />
            <DeleteAccountSection />
          </>
        ) : undefined}
        activity={ctx.role === 'OWNER' ? <ActivityPanel companyId={ctx.companyId} /> : undefined}
        forms={!canManageForms ? undefined :
          <FormsManager
            initialSessionForms={sessionForms.map(f => ({
              id: f.id,
              name: f.name,
              description: f.description,
              introText: f.introText,
              closingText: f.closingText,
              backgroundColor: f.backgroundColor,
              backgroundUrl: f.backgroundUrl,
              questions: Array.isArray(f.questions) ? f.questions as unknown as Question[] : [],
              responses: f._count.responses,
              isActive: f.isActive,
            }))}
            intakeCustomFields={intakeFields}
            intakeFormPublished={trainerProfile.intakeFormPublished}
          />
        }
      />
      </div>
    </>
  )
}
