'use client'

import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { openExternal } from '@/lib/external-link'
import { CURRENCIES, GROWTH_PRICE, DEFAULT_CURRENCY, type CurrencyCode } from '@/lib/pricing'

const schema = z.object({
  businessName: z.string().min(2, 'Business name is required'),
  phone: z.string().min(4, 'Phone number is required'),
  addressLine1: z.string().min(2, 'Street address is required'),
  addressLine2: z.string().optional().transform(v => v?.trim() || ''),
  addressCity: z.string().min(1, 'City is required'),
  addressRegion: z.string().optional().transform(v => v?.trim() || ''),
  addressPostcode: z.string().min(2, 'Postcode is required'),
  addressCountry: z.string().min(2, 'Country is required'),
})

type FormValues = z.infer<typeof schema>

interface Props {
  planId: string | null
  planName: string
  purchasable: boolean
  // Currency codes that have a Stripe Price ID wired up. Anything not
  // in here gets disabled in the dropdown (the trainer can still see
  // the published price, but Checkout would fail).
  configuredCurrencies: string[]
  defaults: {
    businessName: string
    phone: string
    addressLine1: string
    addressLine2: string
    addressCity: string
    addressRegion: string
    addressPostcode: string
    addressCountry: string
  }
}

// Single-column setup form. Captures business name + phone + full
// address, lets the trainer pick a currency, and shows the Growth
// tier price for that currency (sourced from the shared pricing
// table — same numbers as pupmanager.com/pricing).
//
// We're a one-trainer-per-account product right now, so there's no
// seat slider; quantity is always 1.
export function SetupForm({ planId, planName, purchasable, configuredCurrencies, defaults }: Props) {
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const meta = useMemo(() => CURRENCIES.find(c => c.code === currency)!, [currency])
  const total = useMemo(() => GROWTH_PRICE[currency], [currency])
  const fallback = !configuredCurrencies.includes(currency)

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema) as never,
    defaultValues: defaults as FormValues,
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, planId, currency }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Checkout failed (${res.status})`)
      if (!data.url) throw new Error('Stripe did not return a URL')
      openExternal(data.url)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <Section label="Your business">
        <Field label="Business name" error={errors.businessName?.message}>
          <input
            {...register('businessName')}
            type="text"
            autoComplete="organization"
            className={inputClass}
          />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <input
            {...register('phone')}
            type="tel"
            autoComplete="tel"
            placeholder="+64 …"
            className={inputClass}
          />
        </Field>
      </Section>

      <Section label="Business address">
        <Field label="Street address" error={errors.addressLine1?.message}>
          <input
            {...register('addressLine1')}
            type="text"
            autoComplete="address-line1"
            placeholder="42 Wagging Tail Lane"
            className={inputClass}
          />
        </Field>
        <Field label="Apartment, suite, etc. (optional)">
          <input
            {...register('addressLine2')}
            type="text"
            autoComplete="address-line2"
            className={inputClass}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" error={errors.addressCity?.message}>
            <input
              {...register('addressCity')}
              type="text"
              autoComplete="address-level2"
              className={inputClass}
            />
          </Field>
          <Field label="Region / state (optional)">
            <input
              {...register('addressRegion')}
              type="text"
              autoComplete="address-level1"
              className={inputClass}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Postcode" error={errors.addressPostcode?.message}>
            <input
              {...register('addressPostcode')}
              type="text"
              autoComplete="postal-code"
              className={inputClass}
            />
          </Field>
          <Field label="Country" error={errors.addressCountry?.message}>
            <input
              {...register('addressCountry')}
              type="text"
              autoComplete="country-name"
              className={inputClass}
            />
          </Field>
        </div>
      </Section>

      <Section label="Plan">
        <div>
          <label className="text-sm font-medium" style={{ color: 'var(--pm-ink-700)' }}>
            Currency
          </label>
          <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {CURRENCIES.map(c => {
              const active = c.code === currency
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => setCurrency(c.code)}
                  className={`rounded-xl border px-2 py-2 text-sm font-semibold tabular-nums transition ${
                    active ? 'text-white' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  style={{
                    borderColor: active ? 'var(--pm-brand-600)' : 'var(--pm-ink-100)',
                    background: active ? 'var(--pm-brand-600)' : '#fff',
                  }}
                >
                  {c.symbol} {c.label}
                </button>
              )
            })}
          </div>
        </div>

        <div
          className="mt-2 rounded-xl p-4"
          style={{ background: 'var(--pm-ink-50, #f5f8f9)' }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--pm-ink-500)' }}>
            Total after trial
          </p>
          <p className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-semibold" style={{ color: 'var(--pm-ink-900)' }}>{meta.symbol}</span>
            <span className="text-3xl font-bold tabular-nums" style={{ color: 'var(--pm-ink-900)' }}>{total}</span>
            <span className="text-sm" style={{ color: 'var(--pm-ink-500)' }}>{meta.label} / month</span>
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--pm-ink-500)' }}>
            {planName} · 1 trainer
          </p>
          <p className="mt-2 text-[11px] font-medium" style={{ color: 'var(--pm-brand-700)' }}>
            Free for 10 days · cancel any time.
          </p>
          {fallback && purchasable && (
            <p className="mt-2 text-[11px]" style={{ color: 'var(--pm-ink-500)' }}>
              Stripe checkout for {meta.label} isn&apos;t live yet — we&apos;ll bill you in NZD until that&apos;s wired up.
            </p>
          )}
        </div>
      </Section>

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-white transition disabled:opacity-60"
        style={{ background: 'var(--pm-brand-600)' }}
      >
        {submitting ? 'Opening Stripe…' : 'Continue to payment'}
      </button>

      {!purchasable && (
        <p className="text-[11px]" style={{ color: 'var(--pm-ink-500)' }}>
          Stripe isn&apos;t configured in this environment yet — saving your details, but you&apos;ll need to come back here once payments are wired up.
        </p>
      )}

      {serverError && (
        <p className="text-xs text-red-600">{serverError}</p>
      )}
    </form>
  )
}

const inputClass = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: 'var(--pm-ink-100)' }}>
      <p className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--pm-ink-500)' }}>
        {label}
      </p>
      <div className="flex flex-col gap-4">
        {children}
      </div>
    </div>
  )
}

function Field({
  label, error, children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium" style={{ color: 'var(--pm-ink-700)' }}>{label}</label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
