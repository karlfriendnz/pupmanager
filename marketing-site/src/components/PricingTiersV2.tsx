'use client'

import { useMemo, useState } from 'react'

type CurrencyCode = 'AUD' | 'NZD' | 'GBP' | 'CAD' | 'USD' | 'ZAR'

const currencies: { code: CurrencyCode; symbol: string; label: string }[] = [
  { code: 'AUD', symbol: '$', label: 'AUD' },
  { code: 'NZD', symbol: '$', label: 'NZD' },
  { code: 'GBP', symbol: '£', label: 'GBP' },
  { code: 'CAD', symbol: '$', label: 'CAD' },
  { code: 'USD', symbol: '$', label: 'USD' },
  { code: 'ZAR', symbol: 'R', label: 'ZAR' },
]

/**
 * Slot-based pricing — each "slot" is the price of one additional trainer.
 * Earlier slots cost more, later slots cost less, so the average per-trainer
 * rate goes down as the team grows. Per-trainer drops from $25 → $19 (USD)
 * across the slider.
 *
 *   trainer 1     → tier 0 (full price)
 *   trainers 2–3  → tier 1
 *   trainers 4–6  → tier 2
 *   trainers 7–10 → tier 3
 */
const slotTiers: Record<CurrencyCode, [number, number, number, number]> = {
  AUD: [38, 33, 28, 24],
  NZD: [40, 35, 30, 25],
  GBP: [20, 18, 15, 13],
  CAD: [35, 31, 26, 22],
  USD: [25, 22, 19, 16],
  ZAR: [450, 400, 350, 290],
}

function priceForSlot(currency: CurrencyCode, slot: number): number {
  const tiers = slotTiers[currency]
  if (slot <= 1) return tiers[0]
  if (slot <= 3) return tiers[1]
  if (slot <= 6) return tiers[2]
  return tiers[3]
}

function trainerSubtotal(currency: CurrencyCode, count: number): number {
  let total = 0
  for (let slot = 1; slot <= count; slot++) total += priceForSlot(currency, slot)
  return total
}

type FeatureIcon =
  | 'users'
  | 'calendar'
  | 'sync'
  | 'class'
  | 'template'
  | 'chart'
  | 'video'
  | 'phone'
  | 'message'
  | 'inbox'
  | 'trophy'
  | 'heart'

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

export function PricingTiersV2() {
  const [currency, setCurrency] = useState<CurrencyCode>('NZD')
  // Trainers is locked to 1 until multi-trainer accounts ship. The
  // tiered pricing logic stays in slotTiers/trainerSubtotal so we can
  // unlock the slider in one line when the feature lands.
  const trainers = 1

  const active = currencies.find((c) => c.code === currency)!

  const total = useMemo(
    () => trainerSubtotal(currency, trainers),
    [currency, trainers],
  )

  return (
    <div data-reveal className="mx-auto max-w-6xl">
      <div className="overflow-hidden rounded-3xl border border-ink-100 bg-white shadow-xl shadow-ink-900/5">
        {/* Trial banner — soft gold, not shouting */}
        <div className="relative bg-accent-400/15 px-6 py-4 sm:px-10">
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-ink-900">
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 shrink-0 text-accent-500"
              >
                <path d="M12 8v5l3 2" />
                <circle cx="12" cy="12" r="9" />
              </svg>
              <span>
                <strong className="font-semibold">10 days free</strong> · every feature, up to 3
                dogs, no card needed.
              </span>
            </p>
            <a
              href="https://app.pupmanager.com/register"
              className="font-semibold text-accent-500 hover:text-accent-500/80"
            >
              Start free trial →
            </a>
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-5">
          {/* Configurator */}
          <div className="p-8 sm:p-10 lg:col-span-3 lg:border-r lg:border-ink-100">
            <h2 className="text-3xl font-semibold tracking-tight text-ink-900">
              Build your plan
            </h2>
            <p className="mt-2 text-base text-ink-700">
              Pay for what you actually use. Move the slider, pick the add-ons that fit.
            </p>

            {/* Trainers — locked to 1 until multi-trainer ships */}
            <div className="mt-10">
              <div className="flex items-baseline justify-between">
                <span className="text-base font-semibold text-ink-900">Trainers</span>
                <span className="text-3xl font-bold tracking-tight text-accent-500">1</span>
              </div>
              <p className="mt-3 text-sm text-ink-500">
                <span className="mr-1.5 inline-block rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-500 align-middle">
                  Soon
                </span>
                Multi-trainer accounts and a shared team calendar are on the way.{' '}
                <a href="/contact" className="font-medium text-brand-700 hover:text-brand-800">
                  Got a team?
                </a>
              </p>
            </div>

          </div>

          {/* Summary */}
          <aside className="bg-ink-50 p-8 sm:p-10 lg:col-span-2">
            <div className="lg:sticky lg:top-24">
              {/* Currency selector */}
              <div>
                <span className="block text-xs font-semibold tracking-[0.18em] text-ink-500">
                  CURRENCY
                </span>
                <div className="relative mt-1 inline-flex items-center gap-2 border-b border-ink-300 pb-1 pr-1">
                  <span className="text-base font-semibold text-ink-900">
                    {active.symbol} {active.label}
                  </span>
                  <svg
                    className="h-4 w-4 text-brand-600"
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

              <p className="mt-8 text-sm font-semibold uppercase tracking-[0.16em] text-ink-500">
                Your plan
              </p>

              <div className="mt-4 flex items-start text-accent-500">
                <span className="mt-2 text-xl font-semibold">{active.symbol}</span>
                <span className="px-1 text-6xl font-bold leading-none tracking-tight">
                  {total}
                </span>
                <div className="mt-1 flex flex-col text-left">
                  <span className="text-base font-semibold">{active.label}</span>
                  <span className="mt-1 text-sm font-medium text-ink-700">/ month</span>
                </div>
              </div>

              <ul className="mt-6 space-y-3 border-t border-ink-200/70 pt-6 text-sm">
                <li className="flex items-start justify-between gap-4">
                  <span className="text-ink-700">1 trainer</span>
                  <span className="font-medium text-ink-900">
                    {active.symbol}
                    {total}
                  </span>
                </li>
              </ul>

              <div className="mt-6 border-t border-ink-200/70 pt-6">
                <a
                  href="https://app.pupmanager.com/register"
                  className="block rounded-full bg-brand-600 px-6 py-3 text-center text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  Start your FREE trial
                </a>
                <p className="mt-3 text-center text-xs text-ink-500">
                  10 days free. Up to 3 dogs. No card needed.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* What's included — separate card below */}
      <div className="mt-6 overflow-hidden rounded-3xl border border-ink-100 bg-white p-8 shadow-xl shadow-ink-900/5 sm:p-10">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h3 className="text-2xl font-semibold tracking-tight text-ink-900">
            What&rsquo;s included
          </h3>
          <p className="text-sm text-ink-500">
            Every feature, every plan. No add-ons required.
          </p>
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

function CheckIcon({ className = 'text-accent-500' }: { className?: string }) {
  return (
    <svg
      className={`mt-0.5 h-5 w-5 shrink-0 ${className}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.7-9.3a1 1 0 0 0-1.4-1.4L9 10.6 7.7 9.3a1 1 0 0 0-1.4 1.4l2 2a1 1 0 0 0 1.4 0l4-4Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/**
 * 24×24 line icons for the feature list. Heroicons-style outline,
 * stroke-1.75, no fill — colour controlled by the parent.
 */
function FeatureGlyph({ name }: { name: FeatureIcon }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className: 'h-5 w-5',
  }
  switch (name) {
    case 'users':
      return (
        <svg {...common}>
          <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" />
          <circle cx="10" cy="8" r="3.5" />
          <path d="M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.36" />
          <path d="M16 5.5a3.5 3.5 0 0 1 0 6.5" />
        </svg>
      )
    case 'calendar':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 9.5h17" />
          <path d="M8 3.5v3M16 3.5v3" />
        </svg>
      )
    case 'sync':
      return (
        <svg {...common}>
          <path d="M4 8.5a8 8 0 0 1 14-3" />
          <path d="M18 4v4h-4" />
          <path d="M20 15.5a8 8 0 0 1-14 3" />
          <path d="M6 20v-4h4" />
        </svg>
      )
    case 'class':
      return (
        <svg {...common}>
          <circle cx="12" cy="7" r="3" />
          <path d="M5.5 18.5a6.5 6.5 0 0 1 13 0" />
          <circle cx="5" cy="9" r="2" />
          <circle cx="19" cy="9" r="2" />
        </svg>
      )
    case 'template':
      return (
        <svg {...common}>
          <rect x="4" y="3.5" width="16" height="17" rx="2" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      )
    case 'chart':
      return (
        <svg {...common}>
          <path d="M4 20h16" />
          <rect x="6" y="13" width="3" height="6" rx="0.5" />
          <rect x="11" y="9" width="3" height="10" rx="0.5" />
          <rect x="16" y="5" width="3" height="14" rx="0.5" />
        </svg>
      )
    case 'video':
      return (
        <svg {...common}>
          <rect x="3" y="6" width="13" height="12" rx="2" />
          <path d="M16 10l5-3v10l-5-3z" />
        </svg>
      )
    case 'phone':
      return (
        <svg {...common}>
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
          <path d="M11 18.5h2" />
        </svg>
      )
    case 'message':
      return (
        <svg {...common}>
          <path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3l-3 3.5v-3.5H6a2 2 0 0 1-2-2z" />
          <path d="M8 9.5h8M8 12.5h5" />
        </svg>
      )
    case 'inbox':
      return (
        <svg {...common}>
          <path d="M3.5 13l2.5-7a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 6l2.5 7" />
          <path d="M3.5 13v5a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5h-5l-2 2.5h-3l-2-2.5z" />
        </svg>
      )
    case 'trophy':
      return (
        <svg {...common}>
          <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
          <path d="M5 5h3v3a3 3 0 0 1-3-3z" />
          <path d="M19 5h-3v3a3 3 0 0 0 3-3z" />
          <path d="M9 19h6" />
          <path d="M12 13v6" />
        </svg>
      )
    case 'heart':
      return (
        <svg {...common}>
          <path d="M12 20.5l-7.4-7.5a4.5 4.5 0 0 1 6.4-6.4l1 1 1-1a4.5 4.5 0 1 1 6.4 6.4z" />
        </svg>
      )
  }
}
