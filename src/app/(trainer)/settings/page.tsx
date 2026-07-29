import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { TrainerSettingsForm } from './trainer-settings-form'
import { SettingsTabs } from './settings-tabs'
import { NotificationsPanel } from './notifications-panel'
import { EmailTemplatesPanel } from './email-templates-panel'
import { TeamPanel } from './team-panel'
import { BillingPanel } from './billing-panel'
import { DeleteAccountSection } from './delete-account-section'
import { PaymentsPanel } from './payments-panel'
import { ActivityPanel } from './activity-panel'
import { AddonsTab } from './addons-tab'
import { DaycareTab } from './daycare-tab'
import { IntegrationTab } from './integration-tab'
import { XeroTab } from './xero-tab'
import { GoogleCalendarTab } from './google-calendar-tab'
import { hasAddon } from '@/lib/billing'
import { FormsManager } from '../forms/forms-manager'
import { trainerRegionCode } from '@/lib/country'
import { LocationsPanel } from './locations-panel'
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
  // Same pattern for Google Calendar. Connecting previously had no permanent
  // home at all — see google-calendar-tab.tsx. Not gated on settings.edit:
  // the connection is the MEMBER's own calendar, so anyone on the team must be
  // able to connect theirs without permission to change company settings.
  const gcalEnabled = await hasAddon(ctx.companyId, 'googlecalendar')
  // Daycare only has settings when the trainer runs one — same add-on gate the
  // /doggy-daycare board redirects on. Editing the day-parts edits the offering,
  // so it takes the same permission the offering form does.
  const daycareEnabled = can('packages.manage', ctx.role, ctx.permissions) && (await hasAddon(ctx.companyId, 'puppyschool'))

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: { id: true, businessName: true, phone: true, showPhoneToClients: true, signupCountry: true, addressCountry: true, publicEmail: true, logoUrl: true, iconUrl: true, inviteTemplate: true, emailAccentColor: true, intakeSectionOrder: true, intakeSystemFieldSections: true, intakeFormPublished: true, baseAddress: true, baseLat: true, baseLng: true, businessRoles: true, payoutCurrency: true },
  })

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { name: true, email: true, timezone: true, notifyEmail: true, notifyPush: true, landingPage: true, showPageHelp: true },
  })

  if (!user || !trainerProfile) redirect('/login')

  // Locations library — the reusable places the trainer picks from when creating
  // packages/classes/sessions. Only fetched for members who can edit settings
  // (the tab won't render for anyone else; the API re-authorises every write).
  const locations = canEditSettings
    ? await prisma.location.findMany({
        where: { trainerId: trainerProfile.id },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, address: true, imageUrl: true, description: true },
      })
    : []

  // Forms data is only needed for the Forms tab — skip the queries for members
  // who can't manage forms (the tab won't render for them). Lead-capture (embed)
  // forms now live here under Fields & forms too (moved off the Website tab).
  const [customFields, sessionForms, embedForms, clientForms] = canManageForms
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
        prisma.embedForm.findMany({
          where: { trainerId: trainerProfile.id },
          orderBy: { createdAt: 'desc' },
        }),
        // Unified client forms — rendered from the server like everything else
        // on this screen, rather than fetched on mount, so the list doesn't
        // flash a spinner every time the tab opens.
        prisma.form.findMany({
          where: { trainerId: trainerProfile.id },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, name: true, description: true, isActive: true,
            usableAsIntake: true, usableAsEnquiry: true, questions: true,
            _count: { select: { assignedClients: true, enquiries: true } },
          },
        }),
      ])
    : [[], [], [], []] as const

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
          <TrainerSettingsForm user={user} profile={trainerProfile} section="details" />
        ) : undefined}
        design={canEditSettings ? (
          <TrainerSettingsForm user={user} profile={trainerProfile} section="design" />
        ) : undefined}
        notifications={<NotificationsPanel manageableMembers={manageableMembers} />}
        locations={canEditSettings ? <LocationsPanel locations={locations} region={trainerProfile ? trainerRegionCode(trainerProfile) : undefined} /> : undefined}
        integration={can('settings.edit', ctx.role, ctx.permissions) ? <IntegrationTab companyId={ctx.companyId} /> : undefined}
        addons={can('billing.view', ctx.role, ctx.permissions) ? <AddonsTab companyId={ctx.companyId} /> : undefined}
        daycare={daycareEnabled ? <DaycareTab companyId={ctx.companyId} /> : undefined}
        emails={<EmailTemplatesPanel inviteTemplate={trainerProfile?.inviteTemplate ?? null} />}
        team={<TeamPanel />}
        payments={ctx.role === 'OWNER' ? <PaymentsPanel companyId={ctx.companyId} /> : undefined}
        xero={xeroEnabled ? <XeroTab companyId={ctx.companyId} /> : undefined}
        calendar={gcalEnabled ? <GoogleCalendarTab /> : undefined}
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
            embedForms={embedForms.map(f => ({
              id: f.id,
              title: f.title,
              description: f.description,
              isActive: f.isActive,
              fieldCount: (Array.isArray(f.fields) ? f.fields.length : 0) + (Array.isArray(f.customFieldIds) ? f.customFieldIds.length : 0),
            }))}
            clientForms={clientForms.map(f => ({
              id: f.id,
              name: f.name,
              description: f.description,
              isActive: f.isActive,
              usableAsIntake: f.usableAsIntake,
              usableAsEnquiry: f.usableAsEnquiry,
              questionCount: Array.isArray(f.questions) ? f.questions.length : 0,
              assignedCount: f._count.assignedClients,
              enquiryCount: f._count.enquiries,
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
