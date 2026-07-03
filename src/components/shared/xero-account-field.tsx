'use client'

import { useEffect, useState } from 'react'

// Drop-in "Xero income account" picker for the product/package/class create +
// edit forms. Fetches the trainer's curated shortlist and renders a dropdown —
// or nothing at all when Xero isn't connected, the add-on is off, or the
// shortlist is empty (so the field only appears when it's useful). Optional:
// an empty value posts to the connection's default income account.
type Account = { code: string; name: string }

export function XeroAccountField({
  value,
  onChange,
  label = 'Xero income account',
  required = false,
  onActiveChange,
}: {
  value: string
  onChange: (code: string) => void
  label?: string
  /** Mark the picker required — the empty option becomes a "Select…" prompt. */
  required?: boolean
  /** Fires once we know whether the picker is showing (accounts exist), so a
   *  parent form can enforce `required` only when the field is actually there. */
  onActiveChange?: (active: boolean) => void
}) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/xero/shortlist')
      .then((r) => r.json())
      .then((d) => {
        if (live && Array.isArray(d.accounts)) {
          setAccounts(d.accounts)
          onActiveChange?.(d.accounts.length > 0)
        }
      })
      .catch(() => {})
      .finally(() => { if (live) setReady(true) })
    return () => { live = false }
    // onActiveChange is a stable setter from the parent — intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!ready || accounts.length === 0) return null

  const invalid = required && !value

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label}{required && <span className="text-rose-500"> *</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-1 ${
          invalid ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-400' : 'border-slate-200 focus:border-teal-500 focus:ring-teal-500'
        }`}
      >
        <option value="">{required ? 'Select an account…' : 'Use my default income account'}</option>
        {accounts.map((a) => (
          <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
        ))}
      </select>
      <p className="mt-1 text-xs text-slate-400">Where this item’s revenue posts in Xero.</p>
    </div>
  )
}
