'use client'

import { useState } from 'react'
import { ClientProfileForm } from './client-profile-form'
import { ClientNotificationSettings } from './client-notification-settings'

type FormProps = React.ComponentProps<typeof ClientProfileForm>

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'dogs', label: 'Dogs' },
  { id: 'notifications', label: 'Notifications' },
] as const
type TabId = (typeof TABS)[number]['id']

export function MyProfileTabs(props: FormProps) {
  const [tab, setTab] = useState<TabId>('profile')

  return (
    <>
      <div className="flex gap-1 mb-6 border-b border-slate-100">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t.id ? 'border-accent text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Profile + Dogs share one form instance (same component position) so
          switching between them keeps unsaved edits + the single Save. */}
      {tab === 'notifications'
        ? <ClientNotificationSettings />
        : <ClientProfileForm {...props} view={tab === 'dogs' ? 'dogs' : 'profile'} />}
    </>
  )
}
