import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TrainerSettingsForm } from './trainer-settings-form'
import { CustomFieldsManager } from './custom-fields-manager'
import { SettingsTabs } from './settings-tabs'
import { NotificationsPanel } from './notifications-panel'
import { Globe, ChevronRight } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Settings' }

export default async function TrainerSettingsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, businessName: true, phone: true, logoUrl: true, dashboardBgUrl: true, inviteTemplate: true, emailAccentColor: true },
  })

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, timezone: true, notifyEmail: true, notifyPush: true },
  })

  if (!user || !trainerProfile) redirect('/login')

  const customFields = await prisma.customField.findMany({
    where: { trainerId: trainerProfile.id },
    orderBy: { order: 'asc' },
  })

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Settings</h1>

      <SettingsTabs
        profile={<TrainerSettingsForm user={user} profile={trainerProfile} />}
        notifications={<NotificationsPanel />}
        customFields={
          <CustomFieldsManager
            initialFields={customFields.map(f => ({
              id: f.id,
              label: f.label,
              type: f.type as 'TEXT' | 'NUMBER' | 'DROPDOWN',
              required: f.required,
              options: Array.isArray(f.options) ? f.options as string[] : [],
              category: f.category ?? null,
              appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
            }))}
          />
        }
        forms={
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-1">Embed forms</h2>
            <p className="text-sm text-slate-500 mb-3">Public intake / lead-capture forms you can drop on your website.</p>
            <Link
              href="/forms"
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 transition-colors"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Globe className="h-4 w-4" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-slate-900">Manage embed forms</span>
                <span className="block text-xs text-slate-500">Create, edit, and grab embed codes</span>
              </span>
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </Link>
          </section>
        }
      />
    </div>
  )
}
