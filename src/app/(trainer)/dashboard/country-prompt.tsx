'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useIsNative } from '@/lib/native'
import { COUNTRIES } from '@/lib/countries'
import { Button } from '@/components/ui/button'

// On the iOS/Android app, the IP-geo country we auto-capture on the web isn't
// available, so a trainer can end up with no country set. Prompt them to pick
// it. Hidden on web (where it's captured at signup) and once a country exists.
export function CountryPrompt({ hasCountry }: { hasCountry: boolean }) {
  const native = useIsNative() // false during SSR + first render, then real value
  const router = useRouter()
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  if (!native || hasCountry || saved) return null

  async function save() {
    if (!code) return
    setSaving(true)
    const res = await fetch('/api/trainer/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signupCountry: code }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      router.refresh()
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-[var(--pm-brand-500)]/30 bg-[var(--pm-brand-500)]/5 p-4">
      <p className="font-semibold text-slate-900">Where are you based?</p>
      <p className="mt-0.5 text-sm text-slate-500">
        Set your country so we can tailor PupManager to your region.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select
          value={code}
          onChange={e => setCode(e.target.value)}
          aria-label="Country"
          className="h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
        >
          <option value="">Select your country…</option>
          {COUNTRIES.map(c => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
        <Button onClick={save} loading={saving} disabled={!code} className="self-start sm:self-auto">
          Save
        </Button>
      </div>
    </div>
  )
}
