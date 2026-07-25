'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { COUNTRIES } from '@/lib/countries'
import { Button } from '@/components/ui/button'

// Asks for the country when we don't have one. It drives the currency a trainer
// is priced and paid in, and it's what Stripe onboarding is opened with.
//
// This used to show on the phone apps only, on the assumption the web captures
// it at signup. The web captures it from an IP-geo header — which an OAuth
// sign-up never passes through at all (its profile is created in a NextAuth
// event, with no request to read), and which can simply be absent behind a VPN.
// Eleven of forty-two businesses had no country as a result, every one of them
// also missing a currency. So it asks wherever it's missing.
export function CountryPrompt({ hasCountry }: { hasCountry: boolean }) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  if (hasCountry || saved) return null

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
