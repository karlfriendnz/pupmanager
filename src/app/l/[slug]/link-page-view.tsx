import type { LinkButton } from '@/lib/link-page'

// Shared presentational component for the "link in bio" page. Rendered by the
// public page (server) AND the in-app editor's live preview (client) so the
// preview always matches reality. No hooks / no client-only APIs — safe in both.

export interface LinkPageViewProps {
  businessName: string
  /** Square brand mark (iconUrl preferred, else logoUrl). Rendered clean — no
   *  coloured box behind an uploaded icon. Null → an initial in an accent disc. */
  avatarUrl: string | null
  headline: string | null
  bio: string | null
  buttons: LinkButton[]
  /** Validated brand accent (hex) or a CSS var fallback. */
  accent: string
  /** Preview mode renders the buttons as non-interactive chrome (no navigation). */
  interactive?: boolean
}

export function LinkPageView({
  businessName,
  avatarUrl,
  headline,
  bio,
  buttons,
  accent,
  interactive = true,
}: LinkPageViewProps) {
  const initial = (businessName || '?').charAt(0).toUpperCase()

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-5 py-10 text-center">
      {/* Avatar — clean, no coloured box behind an uploaded mark. */}
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt={businessName}
          className="h-24 w-24 rounded-full object-contain"
        />
      ) : (
        <div
          className="flex h-24 w-24 items-center justify-center rounded-full text-3xl font-bold text-white"
          style={{ background: accent }}
        >
          {initial}
        </div>
      )}

      <h1 className="mt-4 text-xl font-bold text-slate-900">{businessName}</h1>
      {headline && <p className="mt-1 text-[15px] font-medium text-slate-700">{headline}</p>}
      {bio && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-500">{bio}</p>}

      <div className="mt-7 flex w-full flex-col gap-3">
        {buttons.map((b) =>
          interactive ? (
            <a
              key={b.key}
              href={b.href}
              {...(b.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="flex h-14 w-full items-center justify-center rounded-2xl px-4 text-[15px] font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 active:translate-y-0"
              style={{ background: accent }}
            >
              {b.label}
            </a>
          ) : (
            <div
              key={b.key}
              className="flex h-14 w-full items-center justify-center rounded-2xl px-4 text-[15px] font-semibold text-white shadow-sm"
              style={{ background: accent }}
            >
              {b.label}
            </div>
          ),
        )}
        {buttons.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-400">
            No buttons yet — turn one on to see it here.
          </p>
        )}
      </div>
    </div>
  )
}
