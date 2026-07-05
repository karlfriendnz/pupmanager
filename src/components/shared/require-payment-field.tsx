'use client'

import { useEffect, useState } from 'react'

// Tri-state "require payment to book" control for a package / class / product.
//   true  → Require payment (pay up front via Stripe)
//   false → Don't require (book now, pay later — an invoice is raised)
//   null  → Use my default (falls back to the trainer's defaultRequirePayment)
//
// It fetches the trainer's current default so the "Use my default" option can
// spell out what that default resolves to. Self-contained so any form can drop
// it in without threading the default through props.
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

  const defaultWord =
    trainerDefault == null ? 'your default' : trainerDefault ? 'Require payment' : 'Don’t require'

  const options: { val: boolean | null; label: string }[] = [
    { val: true, label: 'Require payment' },
    { val: false, label: 'Don’t require' },
    { val: null, label: `Use my default (${defaultWord})` },
  ]

  return (
    <div>
      <label className="text-sm font-medium text-slate-700 block mb-1.5">Payment to book</label>
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => {
          const on = opt.val === value
          return (
            <button
              key={String(opt.val)}
              type="button"
              onClick={() => onChange(opt.val)}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-slate-400 mt-1">
        When on, clients pay up front to confirm. When off, they book now and you raise an invoice.
        Only applies once you can take card payments.
      </p>
    </div>
  )
}
