import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The photograph behind the top of the trainer's home screen, and the fade that
 * gets rid of it again.
 *
 * The shape of it, in the trainer's own words: the image is at full strength
 * behind the logo and the greeting, then dissolves into the ordinary page
 * background across the run of rows and tiles underneath — clean at the TOP of
 * that run, completely gone by its BOTTOM.
 *
 * ── How the fade is anchored ──────────────────────────────────────────────
 * The obvious implementation is to measure the rows with a ref and size a
 * gradient to match. That was rejected: the rows change height on every render
 * (a booking request arrives, the "things to review" strip opens, a trainer's
 * trade gives them four tiles instead of six), so a measured gradient is always
 * one paint behind the thing it's covering, and it flashes on first mount.
 *
 * Instead the gradient is `absolute inset-0` of the rows' OWN wrapper. Its
 * height is therefore, by construction, exactly the rows' height — no
 * measurement, no effect, no resize observer, correct on the server render.
 * `children` is what the trainer marked as the red box; the fade covers it and
 * nothing else.
 *
 * The image layer spans the lockup AND the rows (`inset-0` of the outer box),
 * so it is uncovered up top and progressively covered on the way down. Both
 * layers bleed `-inset-x-4` to cancel the dashboard container's p-4, because a
 * background image with 16px of page showing down each side reads as a picture
 * in a box rather than a background.
 *
 * ── Legibility ────────────────────────────────────────────────────────────
 * The rows and tiles are opaque white blocks, so they are unaffected. The only
 * content sitting DIRECTLY on the photo is the logo and the greeting, and a
 * trainer can upload anything — a bright sky, a busy park. Rather than dim the
 * photo (which is the one thing the trainer asked to see at full strength), the
 * two elements carry their own contrast: a white halo behind the greeting text
 * so dark type survives a dark photo, and a soft drop shadow under the logo so
 * a pale wordmark doesn't dissolve into a pale background. Both only apply when
 * there IS an image.
 */

/** Fade FROM nothing TO the page background, over the rows' full height. */
const FADE = 'linear-gradient(to bottom, rgb(var(--pm-page-bg-rgb) / 0) 0%, rgb(var(--pm-page-bg-rgb) / 0.72) 62%, rgb(var(--pm-page-bg-rgb) / 1) 100%)'

/**
 * Dark type on an unknown photo: a white halo is what keeps it readable.
 *
 * Stacked rather than single, and the innermost ring fully opaque, because a
 * single soft glow was NOT enough — the first real photo tried here put the
 * greeting over a head of dark brown hair and slate type on it was legible but
 * uncomfortably tight. The tight opaque ring gives the glyphs an edge whatever
 * they land on; the wider soft ones lift them off the busy detail behind.
 */
const HALO = [
  '0 0 3px rgb(255 255 255)',
  '0 0 6px rgb(255 255 255)',
  '0 1px 12px rgb(255 255 255 / 0.9)',
].join(', ')

/** A pale logo on a pale photo needs an edge; a dark one is unharmed by it. */
const LOGO_SHADOW = 'drop-shadow(0 1px 3px rgb(15 23 42 / 0.35))'

/**
 * Quote a URL for use inside CSS `url()`. The stored value is validated as an
 * https URL on write, but this is a string being pasted into a stylesheet, so
 * it gets escaped at the point of use rather than trusted from storage.
 */
function cssUrl(url: string): string {
  return `url("${url.replace(/["\\]/g, '\\$&').replace(/[\r\n]/g, '')}")`
}

export function HomeHero({
  imageUrl,
  showLogo,
  logoUrl,
  businessName,
  firstName,
  greeting,
  children,
}: {
  /** The trainer's uploaded background photo, or null for none. */
  imageUrl: string | null
  /** Company-wide choice: is the logo lockup shown over the image at all? */
  showLogo: boolean
  logoUrl: string | null
  businessName: string
  firstName: string
  /** "morning" / "afternoon" / "evening". */
  greeting: string
  /** The rows and tiles the fade lands across. */
  children: ReactNode
}) {
  const image = imageUrl?.trim() || null

  return (
    <div className="relative">
      {/* The photograph. Spans the lockup and the rows; bleeds past the
          container's padding on both sides and up over its top pad so it
          reaches the header rather than floating in the content well. */}
      {image && (
        <div
          aria-hidden
          data-testid="home-hero-image"
          className="pointer-events-none absolute -inset-x-4 -top-5 bottom-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: cssUrl(image) }}
        />
      )}

      {/* The logo + greeting. Centred and given room — the business name in
          text would only repeat what the logo already says. The trainer can
          turn the logo off for the whole company and keep just the greeting,
          in which case a min-height keeps the photo something to be seen. */}
      <div
        className={cn(
          'relative mb-5 flex flex-col items-center pt-1',
          image && !showLogo && 'min-h-[104px] justify-end pb-1',
          image && showLogo && 'pt-3',
        )}
      >
        {showLogo && (logoUrl ? (
          // Plain <img>: trainer logos live on Vercel Blob, which isn't in
          // next/image's remotePatterns (same as everywhere else).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={businessName || 'Business logo'}
            className="h-20 w-auto max-w-[70%] object-contain"
            style={image ? { filter: LOGO_SHADOW } : undefined}
          />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-2xl border border-slate-200 bg-white text-2xl font-semibold text-slate-700">
            {(businessName || firstName || 'P').charAt(0).toUpperCase()}
          </span>
        ))}
        <p
          className={cn('text-[13px]', showLogo && 'mt-2.5', image ? 'font-medium text-slate-700' : 'text-slate-500')}
          style={image ? { textShadow: HALO } : undefined}
        >
          Good {greeting}{firstName ? `, ${firstName}` : ''}
        </p>
      </div>

      {/* The rows and tiles. This wrapper's height IS the fade's height — see
          the note at the top of the file. */}
      <div className="relative">
        {image && (
          <div
            aria-hidden
            data-testid="home-hero-fade"
            className="pointer-events-none absolute -inset-x-4 inset-y-0"
            style={{ background: FADE }}
          />
        )}
        <div className="relative">{children}</div>
      </div>
    </div>
  )
}
