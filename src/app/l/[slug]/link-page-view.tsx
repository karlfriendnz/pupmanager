import { Calendar, Link2, Globe, Mail, Phone, LogIn, Gift, MessageSquare } from 'lucide-react'
import type { LinkButton, LinkButtonIcon, SocialLink } from '@/lib/link-page'
import { linkPageFontStack } from '@/lib/link-page'

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
  /** Social profiles rendered as a centered icon row below the main buttons. */
  socials?: SocialLink[]
  /** Heading shown above the social icon row. Empty → no heading (icons only). */
  socialsLabel?: string | null
  /** Full-cover background image. When set, text goes white over a dark overlay. */
  backgroundUrl?: string | null
  /** Stored font id (null = default). Resolved to a CSS stack for fontFamily. */
  font?: string | null
  /** Validated brand accent (hex) or a CSS var fallback. */
  accent: string
  /** Preview mode renders the buttons as non-interactive chrome (no navigation). */
  interactive?: boolean
}

// ── lucide icon per main-button id ───────────────────────────────────────────
const BUTTON_ICONS: Record<LinkButtonIcon, typeof Calendar> = {
  calendar: Calendar,
  link: Link2,
  globe: Globe,
  mail: Mail,
  phone: Phone,
  login: LogIn,
  gift: Gift,
  message: MessageSquare,
}

// ── Brand glyphs ─────────────────────────────────────────────────────────────
// lucide-react has no Instagram/Facebook/TikTok exports, so these are
// hand-written monochrome glyphs (fill=currentColor, sized via className).
function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable="false">
      <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.31-1.46.72-2.12 1.38C1.35 2.67.94 3.34.63 4.14.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.8.72 1.47 1.38 2.13.66.66 1.33 1.07 2.12 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56.8-.31 1.47-.72 2.13-1.38.66-.66 1.07-1.33 1.38-2.13.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.9 5.9 0 0 0-1.38-2.12A5.9 5.9 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0z" />
      <path d="M12 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84zM12 16a4 4 0 1 1 4-4 4 4 0 0 1-4 4z" />
      <circle cx="18.41" cy="5.59" r="1.44" />
    </svg>
  )
}

function FacebookGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable="false">
      <path d="M24 12a12 12 0 1 0-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.93-1.95 1.87V12h3.32l-.53 3.47h-2.79v8.38A12 12 0 0 0 24 12z" />
    </svg>
  )
}

function TiktokGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable="false">
      <path d="M16.6 5.82a4.28 4.28 0 0 1-1.05-2.82h-3.3v13.4a2.44 2.44 0 0 1-2.44 2.36 2.44 2.44 0 1 1 .76-4.76V10.6a5.73 5.73 0 0 0-.76-.05 5.73 5.73 0 1 0 5.73 5.73V9.01a7.62 7.62 0 0 0 4.45 1.42V7.13a4.28 4.28 0 0 1-3.39-1.31z" />
    </svg>
  )
}

const SOCIAL_META: Record<SocialLink['platform'], { label: string; Glyph: (p: { className?: string }) => React.ReactElement }> = {
  instagram: { label: 'Instagram', Glyph: InstagramGlyph },
  facebook: { label: 'Facebook', Glyph: FacebookGlyph },
  tiktok: { label: 'TikTok', Glyph: TiktokGlyph },
}

export function LinkPageView({
  businessName,
  avatarUrl,
  headline,
  bio,
  buttons,
  socials = [],
  socialsLabel,
  backgroundUrl,
  font,
  accent,
  interactive = true,
}: LinkPageViewProps) {
  const initial = (businessName || '?').charAt(0).toUpperCase()
  const onDark = Boolean(backgroundUrl)
  const fontStack = linkPageFontStack(font)
  const label = (socialsLabel ?? '').trim()

  return (
    <div
      className="relative flex min-h-full w-full flex-col items-center"
      style={{ fontFamily: fontStack }}
    >
      {/* Full-cover background + dark overlay so text/buttons stay legible. */}
      {backgroundUrl && (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${backgroundUrl})` }}
            aria-hidden
          />
          <div className="absolute inset-0 bg-black/35" aria-hidden />
        </>
      )}

      <div className="relative z-10 flex w-full max-w-md flex-col items-center px-5 py-10 text-center">
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

        <h1 className={`mt-4 text-xl font-bold ${onDark ? 'text-white' : 'text-slate-900'}`}>{businessName}</h1>
        {headline && (
          <p className={`mt-1 text-[15px] font-medium ${onDark ? 'text-white/90' : 'text-slate-700'}`}>{headline}</p>
        )}
        {bio && (
          <p className={`mt-2 whitespace-pre-line text-sm leading-relaxed ${onDark ? 'text-white/80' : 'text-slate-500'}`}>{bio}</p>
        )}

        <div className="mt-7 flex w-full flex-col gap-3">
          {buttons.map((b) => {
            const Icon = BUTTON_ICONS[b.icon]
            // Per-button overrides, each falling back to the page-level styling.
            const bg = b.style?.bgColor ?? accent
            const btnStyle: React.CSSProperties = { background: bg }
            if (b.style?.textColor) btnStyle.color = b.style.textColor
            const inner = (
              <>
                {b.style?.imageUrl ? (
                  // Small rounded image at the LEFT, in place of the lucide icon.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={b.style.imageUrl}
                    alt=""
                    aria-hidden
                    className="h-8 w-8 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <Icon className="h-5 w-5 shrink-0" aria-hidden />
                )}
                <span className="flex-1 text-center">{b.label}</span>
                {/* Matching spacer on the right keeps the label centred. */}
                <span className={`shrink-0 ${b.style?.imageUrl ? 'h-8 w-8' : 'h-5 w-5'}`} aria-hidden />
              </>
            )
            return interactive ? (
              <a
                key={b.key}
                href={b.href}
                {...(b.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="flex h-14 w-full items-center gap-2 rounded-2xl px-4 text-[15px] font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 active:translate-y-0"
                style={btnStyle}
              >
                {inner}
              </a>
            ) : (
              <div
                key={b.key}
                className="flex h-14 w-full items-center gap-2 rounded-2xl px-4 text-[15px] font-semibold text-white shadow-sm"
                style={btnStyle}
              >
                {inner}
              </div>
            )
          })}
          {buttons.length === 0 && (
            <p className={`rounded-2xl border border-dashed px-4 py-6 text-sm ${onDark ? 'border-white/30 text-white/70' : 'border-slate-200 text-slate-400'}`}>
              No buttons yet — turn one on to see it here.
            </p>
          )}
        </div>

        {/* Socials — a thin divider, an optional heading, then a row of circular
            icon buttons (NOT full-width buttons). */}
        {socials.length > 0 && (
          <div className="mt-8 w-full">
            <div className={`border-t ${onDark ? 'border-white/25' : 'border-slate-200'}`} />
            {label && (
              <p className={`mt-4 text-xs font-medium ${onDark ? 'text-white/80' : 'text-slate-500'}`}>{label}</p>
            )}
            <div className={`flex items-center justify-center gap-3 ${label ? 'mt-3' : 'mt-4'}`}>
              {socials.map((s) => {
                const { label: platformLabel, Glyph } = SOCIAL_META[s.platform]
                const cls = `flex h-11 w-11 items-center justify-center rounded-full shadow-sm transition-transform hover:-translate-y-0.5 active:translate-y-0 ${onDark ? 'bg-white/15 text-white ring-1 ring-white/30' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`
                return interactive ? (
                  <a
                    key={s.platform}
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={platformLabel}
                    className={cls}
                  >
                    <Glyph className="h-5 w-5" />
                  </a>
                ) : (
                  <div key={s.platform} aria-label={platformLabel} className={cls}>
                    <Glyph className="h-5 w-5" />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
