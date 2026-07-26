'use client'

import { useEffect, useState } from 'react'
import { Switch } from '@/components/ui/switch'

// "Require payment to book" for a package / class / product.
//
// The stored value is still tri-state — true / false / null (= inherit the
// trainer's defaultRequirePayment) — because that's what the API and existing
// rows use. The CONTROL, though, is one switch: it starts on whatever the
// trainer's default resolves to, and flipping it writes an explicit true/false.
// Leaving it alone keeps the stored null, which resolves to the same thing.
//
// It fetches the trainer's default itself, so any form can drop it in without
// threading the default through props.
export function RequirePaymentField({
  value,
  onChange,
}: {
  value: boolean | null
  onChange: (v: boolean | null) => void
}) {
  const [trainerDefault, setTrainerDefault] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/trainer/profile')
      .then(r => (r.ok ? r.json() : null))
      .then((p: unknown) => {
        if (cancelled || !p || typeof p !== 'object') return
        const d = (p as { defaultRequirePayment?: unknown }).defaultRequirePayment
        if (typeof d === 'boolean') setTrainerDefault(d)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // What will actually happen: the explicit choice if there is one, otherwise
  // the trainer's default (off until we know it).
  const on = value ?? trainerDefault ?? false
  const usingDefault = value === null

  return (
    <div>
      <div className="flex items-start gap-3">
        <Switch
          checked={on}
          onChange={() => onChange(!on)}
          aria-label="Require payment to book"
        />
        <div className="min-w-0">
          <label className="text-sm font-medium text-slate-700 block">
            Require payment to book
          </label>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {on
              ? 'Clients pay up front to confirm their spot.'
              : 'Clients book now and you raise an invoice.'}
            {usingDefault && ' Your default — change it here just for this one.'}
          </p>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 mt-1.5">
        Only applies once you can take card payments.
      </p>
    </div>
  )
}
