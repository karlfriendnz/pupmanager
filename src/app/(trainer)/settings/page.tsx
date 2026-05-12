import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TrainerSettingsForm } from './trainer-settings-form'
import { SettingsTabs } from './settings-tabs'
import { NotificationsPanel } from './notifications-panel'
import { FormsManager } from '../forms/forms-manager'
import type { Question } from '../forms/session/session-forms-manager'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Settings' }

export default async function TrainerSettingsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, businessName: true, phone: true, logoUrl: true, dashboardBgUrl: true, inviteTemplate: true, emailAccentColor: true, intakeSectionOrder: true, intakeFormPublished: true },
  })

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, timezone: true, notifyEmail: true, notifyPush: true },
  })

  if (!user || !trainerProfile) redirect('/login')

  const [customFields, embedForms, sessionForms] = await Promise.all([
    prisma.customField.findMany({
      where: { trainerId: trainerProfile.id },
      orderBy: { order: 'asc' },
    }),
    prisma.embedForm.findMany({
      where: { trainerId: trainerProfile.id },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.sessionForm.findMany({
      where: { trainerId: trainerProfile.id },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      include: { _count: { select: { responses: true } } },
    }),
  ])

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
      <div className="p-4 md:p-8 w-full max-w-2xl md:max-w-[872px] mx-auto">

      <SettingsTabs
        profile={<TrainerSettingsForm user={user} profile={trainerProfile} />}
        notifications={<NotificationsPanel notifyEmail={user.notifyEmail} notifyPush={user.notifyPush} />}
        forms={
          <FormsManager
            initialForms={embedForms.map(f => ({
              id: f.id,
              title: f.title,
              description: f.description,
              fields: Array.isArray(f.fields) ? f.fields as { key: string; required: boolean }[] : [],
              customFieldIds: Array.isArray(f.customFieldIds) ? f.customFieldIds as string[] : [],
              thankYouTitle: f.thankYouTitle,
              thankYouMessage: f.thankYouMessage,
              isActive: f.isActive,
            }))}
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
