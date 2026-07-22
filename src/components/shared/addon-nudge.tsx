'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

// A small, dismissible "did you know?" nudge pinned to the bottom-left corner,
// used to surface an add-on that would enhance the current page (e.g. "connect
// Google Calendar" on the schedule). Styled as a mini add-on card so it feels
// of a piece with the Add-ons page. Once dismissed it stays closed — the choice
// is remembered per browser in localStorage, keyed by `id`. Render it only when
// the thing it promotes isn't already set up.
export function AddonNudge({
  id,
  eyebrow,
  title,
  body,
  ctaLabel,
  ctaHref,
  onCta,
  image,
  icon,
  forceShow = false,
  dismissed = false,
}: {
  /** Stable id — the dismissal is remembered under this key. */
  id: string
  eyebrow?: string
  title: string
  body: string
  ctaLabel: string
  ctaHref: string
  /** When set, the CTA runs this instead of navigating to ctaHref — e.g. to
   *  open a promo/connect modal in place. */
  onCta?: () => void
  /** Hero photo that bleeds into the gradient header (same art as the add-on card). */
  image?: { src: string; objectPosition?: string; translateX?: string }
  /** A brand glyph, shown in a floating white tile on the header (e.g. Google). */
  icon?: ReactNode
  /** Dev-only: show immediately, ignoring a prior dismissal (for local preview). */
  forceShow?: boolean
  /** Server-side record of a previous "Not now" for this user (see
   *  lib/nudge-dismissals). Passed by the page so the nudge stays gone on
   *  every device, not just the browser it was dismissed in. */
  dismissed?: boolean
  /** Ignored — lets a registry content object (which carries the add-on id) be
   *  spread onto this component without a type error. The call site supplies the
   *  real dismissal key via `id`. */
  addonId?: string
}) {
  // Start hidden to avoid an SSR/first-paint flash; reveal after we've checked
  // localStorage and let the page settle.
  const [show, setShow] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    // A real, server-recorded "Not now" outranks everything — including the
    // dev preview. forceShow exists so the nudge art is easy to look at
    // locally, but while it also overrode dismissals the feature looked broken
    // in dev: you'd click "Not now" and it was back on the next render.
    if (dismissed) return
    if (forceShow) { setShow(true); return }
    // localStorage stays as a same-device fast path (covers the moment between
    // dismissing and the server state reaching the next render).
    if (localStorage.getItem(`pm-nudge:${id}`) === '1') return
    const t = setTimeout(() => setShow(true), 900)
    return () => clearTimeout(t)
  }, [id, forceShow, dismissed])

  function dismiss() {
    // Local first so it disappears instantly, then persist so it's remembered
    // on the trainer's other devices. Fire-and-forget: a failed write only
    // costs them seeing the nudge again elsewhere.
    try { localStorage.setItem(`pm-nudge:${id}`, '1') } catch { /* ignore */ }
    fetch('/api/nudges/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nudgeId: id }),
    }).catch(() => {})
    setLeaving(true)
    setTimeout(() => setShow(false), 200)
  }

  if (!show) return null

  return (
    <div
      // Sized + placed to nest inside the desktop sidebar column (md:w-64 with
      // px-3 gutters) so it reads as the last item in the left panel, without
      // actually living inside the shell. Desktop-only — the sidebar doesn't
      // exist on mobile (bottom tab bar there).
      className="hidden md:block fixed bottom-4 left-2 z-40 w-[238px]"
      style={{ animation: `${leaving ? 'pmNudgeOut .2s ease-in both' : 'pmNudgeIn .5s cubic-bezier(.22,1,.36,1) both'}` }}
    >
      <style>{`
        @keyframes pmNudgeIn{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
        @keyframes pmNudgeOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(10px) scale(.98)}}
      `}</style>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20">
        {/* Gradient header with the hero photo bleeding in on the right under a
            teal fade — mirrors the Add-ons page card. */}
        <div
          className="relative h-[76px] overflow-hidden text-white"
          style={{ backgroundImage: 'linear-gradient(135deg, #2A9DA9, #1F818C)' }}
        >
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
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
          )}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ backgroundImage: 'linear-gradient(90deg, #1F818C 0%, #1F818C 52%, rgba(31,129,140,0) 100%)' }}
          />

          <div className="relative z-10 flex h-full w-[72%] flex-col justify-center gap-1.5 px-4">
            {eyebrow && (
              <span className="inline-flex w-fit items-center rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm">
                {eyebrow}
              </span>
            )}
            <h3 className="text-[15px] font-bold leading-tight">{title}</h3>
          </div>

          {icon && (
            <div className="absolute bottom-3 right-3 z-10 grid h-9 w-9 place-items-center rounded-xl bg-white shadow-md ring-1 ring-black/5">
              {icon}
            </div>
          )}
        </div>

        {/* Body: blurb + CTA */}
        <div className="p-4 pb-2">
          <p className="text-[13px] leading-snug text-slate-500">{body}</p>
          <div className="mt-3.5">
            {onCta ? (
              <button
                type="button"
                // Acting on the nudge counts as answering it — record the
                // dismissal too, or it keeps reappearing after they've engaged.
                // (The ctaHref <Link> path below already did this.)
                onClick={() => { dismiss(); onCta() }}
                className="group inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-teal-500 to-teal-600 px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm shadow-teal-600/30 transition-all hover:from-teal-500 hover:to-teal-700 hover:shadow-md hover:shadow-teal-600/40 active:scale-[0.98]"
              >
                {ctaLabel}
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </button>
            ) : (
              <Link
                href={ctaHref}
                onClick={dismiss}
                className="group inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-teal-500 to-teal-600 px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm shadow-teal-600/30 transition-all hover:from-teal-500 hover:to-teal-700 hover:shadow-md hover:shadow-teal-600/40 active:scale-[0.98]"
              >
                {ctaLabel}
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            )}
            <button
              type="button"
              onClick={dismiss}
              className="mt-0.5 block w-full text-center text-[12px] font-medium text-slate-400 transition-colors hover:text-slate-600"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// The Google "G" mark, four-colour. Recognisable at a glance and pairs with any
// Google-integration nudge.
export function GoogleGlyph({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
