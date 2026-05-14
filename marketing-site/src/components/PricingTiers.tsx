'use client'

import { useState } from 'react'
import { FeatureGlyph, type FeatureIcon } from './FeatureGlyph'

type CurrencyCode = 'AUD' | 'NZD' | 'GBP' | 'CAD' | 'USD' | 'ZAR'

const currencies: { code: CurrencyCode; symbol: string; label: string }[] = [
  { code: 'AUD', symbol: '$', label: 'AUD' },
  { code: 'NZD', symbol: '$', label: 'NZD' },
  { code: 'GBP', symbol: '£', label: 'GBP' },
  { code: 'CAD', symbol: '$', label: 'CAD' },
  { code: 'USD', symbol: '$', label: 'USD' },
  { code: 'ZAR', symbol: 'R', label: 'ZAR' },
]

const soloPrice: Record<CurrencyCode, number> = {
  AUD: 45,
  NZD: 49,
  GBP: 23,
  CAD: 41,
  USD: 30,
  ZAR: 540,
}

const includedFeatures: { icon: FeatureIcon; label: string }[] = [
  { icon: 'users',    label: 'Unlimited clients and dogs' },
  { icon: 'calendar', label: 'Smart scheduling — recurring sessions, drive-time buffers, auto reminders' },
  { icon: 'sync',     label: 'Two-way Google and Apple Calendar sync' },
  { icon: 'class',    label: 'Group classes with attendance and catch-up tracking' },
  { icon: 'template', label: 'Reusable class plans — build once, run forever' },
  { icon: 'chart',    label: 'Structured session notes with scoring and progress charts' },
  { icon: 'video',    label: 'Phone-shot videos dropped into homework in seconds' },
  { icon: 'phone',    label: 'A branded client app on iPhone, Android, and web' },
  { icon: 'message',  label: 'Per-client messaging with the dog’s full story' },
  { icon: 'inbox',    label: 'Sign-up forms with a tidy new-enquiry inbox' },
  { icon: 'trophy',   label: 'Achievement badges that keep clients motivated' },
  { icon: 'heart',    label: 'Real-human support — same day, most days' },
]

export function PricingTiers() {
  const [currency, setCurrency] = useState<CurrencyCode>('NZD')
  const active = currencies.find((c) => c.code === currency)!

  return (
    <div data-reveal className="mx-auto max-w-3xl">
      {/* Plan card */}
      <div className="overflow-hidden rounded-3xl border border-ink-100 bg-white shadow-xl shadow-ink-900/5">
        <div className="bg-accent-400/15 px-6 py-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-accent-500 sm:px-10">
          One trainer · all features included
        </div>

        <div className="p-8 sm:p-12">
          {/* Big price */}
          <div className="text-center">
            <h2 className="text-base font-semibold uppercase tracking-[0.18em] text-ink-500">
              Solo plan
            </h2>
            <div className="mt-3 flex items-start justify-center text-accent-500">
              <span className="mt-3 text-2xl font-semibold">{active.symbol}</span>
              <span className="px-1 text-7xl font-bold leading-none tracking-tight">
                {soloPrice[currency]}
              </span>
              <div className="mt-2 flex flex-col text-left">
                <span className="text-base font-semibold">{active.label}</span>
                <span className="mt-0.5 text-sm font-medium text-ink-700">/ month</span>
              </div>
            </div>
            <p className="mt-3 text-base text-ink-700">
              Per trainer. One account, one trainer, one tidy bill.
            </p>

            {/* Currency switcher — sits with the price, not floating */}
            <div className="mt-4 flex justify-center">
              <div className="relative inline-flex items-center gap-1 text-sm text-ink-500">
                <span>Showing prices in</span>
                <span className="inline-flex items-center gap-1 font-semibold text-ink-900">
                  {active.label}
                  <svg
                    className="h-3.5 w-3.5 text-brand-600"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </span>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Currency"
                >
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.symbol} {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Trial CTA */}
          <a
            href="https://app.pupmanager.com/register"
            className="mt-8 block rounded-full bg-brand-600 px-6 py-4 text-center text-base font-semibold text-white transition hover:bg-brand-700"
          >
            Start your 10-day free trial
          </a>
          <p className="mt-3 text-center text-xs text-ink-500">
            Every feature, up to 3 dogs, no card needed.
          </p>
        </div>
      </div>

      {/* Multi-trainer coming-soon panel */}
      <div className="mt-6 rounded-3xl border border-ink-100 bg-ink-50 p-8 sm:p-10">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-accent-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
            Coming soon
          </span>
          <h3 className="text-xl font-semibold tracking-tight text-ink-900">
            Multi-trainer accounts
          </h3>
        </div>
        <p className="mt-3 text-ink-700">
          Got more than one trainer? We&rsquo;re building shared team calendars, roles and
          permissions, and a single admin dashboard. Until that ships, every PupManager account
          is one trainer.
        </p>
        <p className="mt-3 text-ink-700">
          Running a team that needs to start now?{' '}
          <a href="/contact" className="font-medium text-brand-700 hover:text-brand-800">
            Get in touch
          </a>{' '}
          — we&rsquo;ll let you know the moment team accounts go live.
        </p>
      </div>

      {/* What's included */}
      <div className="mt-6 overflow-hidden rounded-3xl border border-ink-100 bg-white p-8 shadow-xl shadow-ink-900/5 sm:p-10">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h3 className="text-2xl font-semibold tracking-tight text-ink-900">
            What&rsquo;s included
          </h3>
          <p className="text-sm text-ink-500">Every feature. Nothing held back.</p>
        </div>
        <ul className="mt-8 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {includedFeatures.map((f) => (
            <li key={f.label} className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700">
                <FeatureGlyph name={f.icon} />
              </span>
              <span className="pt-1.5 text-sm text-ink-900">{f.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

