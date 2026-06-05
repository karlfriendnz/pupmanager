'use client'

import { useState } from 'react'
import { ClientProfileForm } from './client-profile-form'
import { ClientNotificationSettings } from './client-notification-settings'

type FormProps = React.ComponentProps<typeof ClientProfileForm>

export function MyProfileTabs(props: FormProps) {
  const [tab, setTab] = useState<'profile' | 'notifications'>('profile')

  return (
    <>
      <div className="flex gap-1 mb-6 border-b border-slate-100">
        {(['profile', 'notifications'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t ? 'border-accent text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t === 'profile' ? 'Profile' : 'Notifications'}
          </button>
        ))}
      </div>

      {tab === 'profile' ? <ClientProfileForm {...props} /> : <ClientNotificationSettings />}
    </>
  )
}
