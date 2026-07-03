'use client'

import { Fragment, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'

// Reusable "feature promo" modal — the polished add-on upsell shell first built
// for the connect-Stripe nudge, generalised so every add-on can reuse it:
// branded teal header with a full-bleed photo + fade, an optional floating
// badge, a left-aligned headline/subhead, then a body with an optional
// "how it works" flow strip, a benefits row, a CTA and a skip.
//
// Per-feature bits (copy, image, icons, CTA action) are passed in; the chrome
// stays identical so the family looks consistent.

// Flow-step icons are sized to this — pass your own SVG/lucide icons at this size.
export const PROMO_ICON = 'h-9 w-9'

export type PromoStep = { icon: ReactNode; label: string }

function FlowArrow() {
  return (
    <svg viewBox="0 0 40 24" fill="none" stroke="#2A9DA9" strokeLinecap="round" strokeLinejoin="round" className="mt-[26px] h-5 w-8 shrink-0">
      <path d="M3 12h28" strokeWidth={2.4} strokeDasharray="0.1 6.5" />
      <path d="M28 6l9 6-9 6" strokeWidth={2.2} />
    </svg>
  )
}

function PromoFlow({ steps }: { steps: PromoStep[] }) {
  return (
    <div className="flex items-start justify-center gap-1">
      {steps.map((s, i) => (
        <Fragment key={s.label}>
          <div className="flex w-24 flex-col items-center gap-3">
            <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#EAF6F5] text-[#1F818C] ring-1 ring-[#2A9DA9]/15">
              {s.icon}
            </div>
            <span className="text-center text-[13px] font-semibold leading-tight text-slate-800">{s.label}</span>
          </div>
          {i < steps.length - 1 && <FlowArrow />}
        </Fragment>
      ))}
    </div>
  )
}

function Benefit({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Check className="h-4 w-4 text-[#1F818C]" strokeWidth={2.5} />
      {children}
    </span>
  )
}

export type FeaturePromoProps = {
  /** Small eyebrow above the title — e.g. the add-on's name. */
  eyebrow?: ReactNode
  title: string
  description: string
  /** Header photo. translateX/objectPosition let you frame the subject. */
  image: { src: string; objectPosition?: string; translateX?: string }
  /** Optional floating accent in the header (absolutely positioned by caller). */
  badge?: ReactNode
  /** Optional "how it works" flow strip. */
  steps?: PromoStep[]
  benefits: string[]
  /** Optional cost/price line shown under the benefits (e.g. per-payment fee). */
  priceNote?: ReactNode
  /** The action button — e.g. <ConnectButton/> or <EnableAddonButton/>. */
  cta: ReactNode
  /** Optional small trust line under the CTA. */
  trust?: ReactNode
  /** Called when the close (X) is clicked. */
  onSkip: () => void
}

export function FeaturePromoCard({
  eyebrow,
  title,
  description,
  image,
  badge,
  steps,
  benefits,
  priceNote,
  cta,
  trust,
  onSkip,
}: FeaturePromoProps) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5">
      <button
        type="button"
        onClick={onSkip}
        aria-label="Close"
        className="absolute right-0 top-0 z-30 flex h-9 w-9 items-center justify-center rounded-bl-2xl rounded-tr-3xl bg-black/15 text-white transition hover:bg-black/30"
      >
        <X className="h-5 w-5" />
      </button>
      {/* Branded header — photo full-bleeds across the box, teal overlay solid
          on the left (behind the copy) → clear on the right. */}
      <div
        className="relative overflow-hidden text-white"
        style={{ backgroundImage: 'linear-gradient(135deg, #2A9DA9, #1F818C)' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.src}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            objectPosition: image.objectPosition ?? 'center 45%',
            transform: image.translateX ? `translateX(${image.translateX})` : undefined,
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ backgroundImage: 'linear-gradient(90deg, #1F818C 0%, #1F818C 38%, rgba(31,129,140,0) 100%)' }}
        />
        {badge}
        <div className="relative z-10 w-[52%] py-[60px] pl-8 pr-3">
          {eyebrow && (
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75">{eyebrow}</p>
          )}
          <h2 className="text-[32px] font-bold leading-[1.1] tracking-tight">{title}</h2>
          <p className="mt-2.5 text-[15px] leading-relaxed text-white/90">{description}</p>
        </div>
      </div>

      {/* Body */}
      <div className="px-8 py-8">
        {steps && steps.length > 0 && <PromoFlow steps={steps} />}

        <div className={`${steps?.length ? 'mt-7 ' : ''}flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5 text-[13px] font-medium text-slate-500`}>
          {benefits.map((b) => (
            <Benefit key={b}>{b}</Benefit>
          ))}
        </div>

        {priceNote && (
          <div className="mt-4 flex justify-center">
            <span className="rounded-full bg-slate-50 px-4 py-2 text-center text-[15px] font-medium text-slate-700 ring-1 ring-slate-200/70">
              {priceNote}
            </span>
          </div>
        )}

        <div className="mt-6 flex flex-col items-center gap-3">
          {cta}
          {trust && <div className="flex items-center gap-1.5 text-[11px] text-slate-400">{trust}</div>}
        </div>
      </div>
    </div>
  )
}

export function FeaturePromoModal(props: FeaturePromoProps & { onClose?: () => void }) {
  const close = props.onClose ?? props.onSkip
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={close} />
      <div className="relative z-50 w-full max-w-2xl">
        <FeaturePromoCard {...props} onSkip={close} />
      </div>
    </div>
  )
}
