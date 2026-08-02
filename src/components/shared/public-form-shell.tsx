import type { ReactNode } from 'react'

/**
 * The frame every screen of a trainer's public run wears: their logo, their
 * business name in their accent, and one heading, over the same slate page.
 *
 * It exists because the run added a screen. The enquiry form, the "set a
 * password" step and the intake gate are three different components on three
 * different routes, and the person filling them in is meant to experience one
 * continuous thing — which they do not if the middle one has its own idea of
 * how big the logo is. One frame, imported three times, is how that stays true
 * without anybody remembering to keep it true.
 *
 * The trainer's colour arrives as the `--accent` custom property, set by the
 * page. Server-safe: no state, no effects, so a server component can render it
 * directly.
 */
export function PublicFormShell({
  businessName,
  trainerLogoUrl,
  heading,
  progress,
  children,
  reviewScope,
}: {
  businessName: string
  trainerLogoUrl: string | null
  heading: string
  /** Dots + "Step n of m". Omitted on a single-screen page, where it is noise. */
  progress?: { index: number; total: number; label?: string }
  children: ReactNode
  /** Lets Karl's review widget pin a comment to THIS step, not "the form". */
  reviewScope?: string
}) {
  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-10" data-review-scope={reviewScope}>
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-8 text-center">
          {trainerLogoUrl && (
            // Plain <img>: the logo is an arbitrary remote URL and this page is
            // public, so next/image's optimiser has nothing to gain. Height-
            // constrained only, so the image keeps its real aspect.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={trainerLogoUrl}
              alt={businessName}
              className="mx-auto mb-4 h-24 w-auto max-w-[280px] object-contain"
            />
          )}
          <p className="mb-2 text-sm font-medium text-[var(--accent,#2563eb)]">{businessName}</p>
          <h1 className="text-2xl font-bold text-slate-900">{heading}</h1>
        </div>

        {progress && progress.total > 1 && (
          <div className="mb-6 flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5">
              {Array.from({ length: progress.total }, (_, i) => (
                <div
                  key={i}
                  aria-hidden
                  className={`h-1.5 rounded-full ${
                    i < progress.index ? 'w-6 bg-emerald-500'
                    : i === progress.index ? 'w-8 bg-[var(--accent,#2563eb)]'
                    : 'w-6 bg-slate-200'
                  }`}
                />
              ))}
            </div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {progress.label ?? `Step ${progress.index + 1} of ${progress.total}`}
            </p>
          </div>
        )}

        {children}
      </div>
    </div>
  )
}

/** The one card the run's content sits in, everywhere. */
export const PUBLIC_FORM_CARD =
  'bg-white rounded-2xl border border-slate-200 p-6 flex flex-col gap-5'

export const PUBLIC_FORM_INPUT =
  'h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--accent,#2563eb)]'
