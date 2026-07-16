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
  const canManageTeam = can('team.manage', ctx.role, ctx.permissions)

  // Members whose notification prefs this actor may edit — same rule the team
  // panel / PATCH route enforce: within the company, not the OWNER, not
  // yourself. Only resolved when the actor can manage the team; otherwise the
  // notifications panel stays self-only. The API re-authorises every write.
  const manageableMembers = canManageTeam
    ? (await prisma.trainerMembership.findMany({
        where: { companyId: ctx.companyId, role: { not: 'OWNER' }, userId: { not: ctx.userId } },
        select: { userId: true, role: true, user: { select: { name: true, email: true } } },
        orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }],
      })).map(m => ({ userId: m.userId, name: m.user.name || m.user.email, role: m.role }))
    : []
  // The Xero tab only exists when the (free) Xero add-on is enabled.
  const xeroEnabled = canEditSettings && (await hasAddon(ctx.companyId, 'xero'))

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: { id: true, businessName: true, phone: true, showPhoneToClients: true, signupCountry: true, publicEmail: true, logoUrl: true, iconUrl: true, inviteTemplate: true, emailAccentColor: true, intakeSectionOrder: true, intakeSystemFieldSections: true, intakeFormPublished: true, baseAddress: true, baseLat: true, baseLng: true, businessRoles: true },
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
    inQuickAdd: f.inQuickAdd,
    options: Array.isArray(f.options) ? f.options as string[] : [],
    category: f.category ?? null,
    appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
    order: f.order,
  }))

  // intakeSectionOrder may be the new shape ({name, description?}[]) or the
  // legacy plain string[] — normalise for the field editor.
  const rawSectionOrder = Array.isArray(trainerProfile.intakeSectionOrder) ? trainerProfile.intakeSectionOrder : []
  const intakeSectionOrder = rawSectionOrder.map(entry =>
    typeof entry === 'string'
      ? { name: entry, description: null }
      : { name: (entry as { name: string }).name, description: (entry as { description?: string | null }).description ?? null }
  )
  const intakeSystemFieldSections =
    (trainerProfile.intakeSystemFieldSections as Partial<Record<'name' | 'email' | 'phone', string | null>> | null) ?? {}

  return (
    <>
      <PageHeader title="Settings" />
      <div className="p-4 md:p-8 w-full">

      <SettingsTabs
        profile={canEditSettings ? (
          <TrainerSettingsForm user={user} profile={trainerProfile} />
        ) : undefined}
        notifications={<NotificationsPanel manageableMembers={manageableMembers} />}
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
            intakeSectionOrder={intakeSectionOrder}
            intakeSystemFieldSections={intakeSystemFieldSections}
            businessRoles={Array.isArray(trainerProfile.businessRoles) ? trainerProfile.businessRoles as string[] : []}
          />
        }
      />
      </div>
    </>
  )
}
