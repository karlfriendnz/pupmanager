'use client'

import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { openExternal } from '@/lib/external-link'
import { useIsNative } from '@/lib/native'
import {
  CURRENCIES,
  ADDONS,
  SEAT_PRICE,
  monthlyTotal,
  DEFAULT_CURRENCY,
  type CurrencyCode,
  type AddonId,
} from '@/lib/pricing'

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
  // Add-on ids that are active in the DB (subset of pricing.ts ADDONS).
  // Display/price come from pricing.ts; this just gates which show.
  availableAddonIds: string[]
  // Whether the per-seat "extra trainer" charge is sellable yet.
  seatAvailable: boolean
  // True when the paywall sent them here (expired trial / no subscription).
  // Only changes the native copy — web always shows the subscribe form.
  locked: boolean
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
// address, lets the trainer pick a currency, choose how many trainers
// (seats) and toggle add-ons, then shows the live monthly total for
// that mix (numbers sourced from the shared pricing table — same as
// pupmanager.com/pricing).
export function SetupForm({
  planId, planName, purchasable, configuredCurrencies,
  availableAddonIds, seatAvailable, locked, defaults,
}: Props) {
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY)
  const [seatCount, setSeatCount] = useState(1)
  const [selectedAddons, setSelectedAddons] = useState<Set<AddonId>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // Only show add-ons the DB has switched on; price/name come from pricing.ts.
  const addons = useMemo(
    () => ADDONS.filter(a => availableAddonIds.includes(a.id)),
    [availableAddonIds],
  )

  const meta = useMemo(() => CURRENCIES.find(c => c.code === currency)!, [currency])
  const extraSeats = Math.max(0, seatCount - 1)
  const total = useMemo(
    () => monthlyTotal(currency, seatCount, [...selectedAddons]),
    [currency, seatCount, selectedAddons],
  )
  const fallback = !configuredCurrencies.includes(currency)

  function toggleAddon(id: AddonId) {
    setSelectedAddons(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const native = useIsNative()

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
        body: JSON.stringify({ ...values, planId, currency, seatCount, addons: [...selectedAddons] }),
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

  // In the native app we never surface subscription purchasing or any
  // steering toward an external payment page (Apple Guideline 3.1.1 — no
  // in-app purchase CTA, no pricing, no "subscribe on the web" link/URL).
  // Trainers reach this page right after signup, when their account is
  // already on a free trial, so we just send them into the app. Account
  // billing is a business matter handled entirely outside the app.
  if (native) {
    // Locked trainers: their access has paused. We must NOT show pricing or
    // any in-app purchase/"subscribe on the web" CTA (Apple Guideline 3.1.1),
    // so we keep it to a neutral status message — billing is handled off-app.
    if (locked) {
      // Apple Guideline 3.1.1 / anti-steering: no pricing, no purchase CTA, and
      // no directing the user off-app to pay (not even "go to the website").
      // Purely informational — point them at support.
      return (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <p className="text-base font-semibold text-slate-900">Your access is paused</p>
          <p className="mt-2 text-sm text-slate-600">
            Your free trial has ended and your account access is paused. Please get in
            touch and we&apos;ll help you get back up and running.
          </p>
        </div>
      )
    }
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-base font-semibold text-slate-900">You&apos;re all set</p>
        <p className="mt-2 text-sm text-slate-600">
          Your PupManager account is ready to go.
        </p>
        <a
          href="/dashboard"
          className="mt-4 inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
          style={{ backgroundColor: 'var(--pm-brand-600)' }}
        >
          Go to your dashboard
        </a>
      </div>
    )
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

        {seatAvailable && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ borderColor: 'var(--pm-ink-100)' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--pm-ink-900)' }}>How many trainers?</p>
              <p className="text-[11px]" style={{ color: 'var(--pm-ink-500)' }}>
                First trainer included · +{meta.symbol}{SEAT_PRICE[currency]}/mo each after
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSeatCount(n => Math.max(1, n - 1))}
                disabled={seatCount === 1}
                aria-label="Fewer trainers"
                className="grid h-8 w-8 place-items-center rounded-lg border text-lg font-semibold disabled:opacity-40"
                style={{ borderColor: 'var(--pm-ink-100)', color: 'var(--pm-ink-700)' }}
              >
                −
              </button>
              <span className="w-6 text-center text-sm font-semibold tabular-nums" style={{ color: 'var(--pm-ink-900)' }}>{seatCount}</span>
              <button
                type="button"
                onClick={() => setSeatCount(n => n + 1)}
                aria-label="More trainers"
                className="grid h-8 w-8 place-items-center rounded-lg border text-lg font-semibold"
                style={{ borderColor: 'var(--pm-ink-100)', color: 'var(--pm-ink-700)' }}
              >
                +
              </button>
            </div>
          </div>
        )}

        {addons.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--pm-ink-500)' }}>
              Add when you want them
            </p>
            {addons.map(a => {
              const on = selectedAddons.has(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleAddon(a.id)}
                  aria-pressed={on}
                  className="flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-left transition"
                  style={{
                    borderColor: on ? 'var(--pm-brand-600)' : 'var(--pm-ink-100)',
                    background: on ? 'var(--pm-brand-50, #eef6f7)' : '#fff',
                  }}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: 'var(--pm-ink-900)' }}>{a.name}</span>
                      {a.badge && (
                        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--pm-ink-100)', color: 'var(--pm-ink-500)' }}>
                          {a.badge}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px]" style={{ color: 'var(--pm-ink-500)' }}>{a.description}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums" style={{ color: on ? 'var(--pm-brand-700)' : 'var(--pm-ink-700)' }}>
                      +{meta.symbol}{a.price[currency]}
                    </span>
                    <span
                      className="grid h-5 w-5 place-items-center rounded-md border text-xs"
                      style={{
                        borderColor: on ? 'var(--pm-brand-600)' : 'var(--pm-ink-200, #cbd5e1)',
                        background: on ? 'var(--pm-brand-600)' : '#fff',
                        color: '#fff',
                      }}
                    >
                      {on ? '✓' : ''}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div
          className="mt-2 rounded-xl p-4"
          style={{ background: 'var(--pm-ink-50, #f5f8f9)' }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--pm-ink-500)' }}>
            {locked ? 'Billed today' : 'Total after trial'}
          </p>
          <p className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-semibold" style={{ color: 'var(--pm-ink-900)' }}>{meta.symbol}</span>
            <span className="text-3xl font-bold tabular-nums" style={{ color: 'var(--pm-ink-900)' }}>{total}</span>
            <span className="text-sm" style={{ color: 'var(--pm-ink-500)' }}>{meta.label} / month</span>
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--pm-ink-500)' }}>
            {planName} · {seatCount} trainer{seatCount === 1 ? '' : 's'}
            {extraSeats > 0 && ` (+${extraSeats} seat${extraSeats === 1 ? '' : 's'})`}
            {selectedAddons.size > 0 && ` · ${selectedAddons.size} add-on${selectedAddons.size === 1 ? '' : 's'}`}
          </p>
          <p className="mt-2 text-[11px] font-medium" style={{ color: 'var(--pm-brand-700)' }}>
            {locked ? 'Billed today · cancel any time.' : 'Free for 10 days · cancel any time.'}
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
