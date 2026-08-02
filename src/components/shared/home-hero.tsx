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
 */

/**
 * Fade FROM nothing TO the page background, over the rows' full height.
 *
 * Full opacity is reached at 88%, not at 100%, and that is the fix for a real
 * defect rather than a rounding preference. The image layer stops dead at the
 * bottom of the rows; if the gradient is still a few percent short of opaque
 * when it gets there, the photo is faintly visible right up to its final pixel
 * and then simply ends — which paints a hard horizontal seam across the screen,
 * level with the bottom of the tiles. Reaching 1.0 early and holding it means
 * the image's bottom edge is already buried under solid colour by the time it
 * arrives. It is still fully opaque AT the bottom, which is what was asked for.
 */
const FADE = [
  'rgb(var(--pm-page-bg-rgb) / 0) 0%',
  'rgb(var(--pm-page-bg-rgb) / 0.62) 55%',
  'rgb(var(--pm-page-bg-rgb) / 1) 88%',
  'rgb(var(--pm-page-bg-rgb) / 1) 100%',
]
const FADE_CSS = `linear-gradient(to bottom, ${FADE.join(', ')})`

/**
 * The greeting, over a photograph nobody has seen yet.
 *
 * The rows and tiles are opaque white blocks, so they are unaffected by the
 * photo. The only content sitting DIRECTLY on it is the logo and this line, and
 * a trainer can upload anything. Dimming the photo was rejected — full strength
 * up there is the thing that was actually asked for — so the text carries its
 * own contrast instead.
 *
 * Two earlier attempts are worth recording, because both looked right in one
 * case and wrong in the other:
 *
 *   1. Dark slate text with a soft white glow. Legible over a bright sky, but
 *      uncomfortably tight over a head of dark brown hair.
 *   2. Dark slate text with THREE stacked opaque white glows. That fixed the
 *      dark case and broke the light one: stacked wide-radius shadows
 *      accumulate into a solid plate roughly the size of the text, which over a
 *      pale sky reads as a grey rectangle behind the words — like selected
 *      text, or something failing to render. Karl saw it and said so.
 *
 * The robust direction is the opposite one. WHITE text with a soft dark halo
 * works both ways round for the same reason a photo caption does: on a dark
 * photo the white fill carries it, on a light photo the dark halo does. Neither
 * radius is wide enough to build a plate, so there is nothing to read as a box.
 */
// REMOVED at Karl's request — he looked at it on his own photo and wanted the
// text clean. Kept as a record of what was tried, and of the risk that comes
// with none of it: the greeting is plain white over whatever gets uploaded, so
// a pale photo behind it will be hard to read. If that turns up, the answer is
// probably to dim the photograph slightly rather than to dress the type.
// const GREETING_SHADOW = '0 1px 3px rgb(15 23 42 / 0.75), 0 0 14px rgb(15 23 42 / 0.45)'

/** A pale logo on a pale photo needs an edge; a dark one is unharmed by it. */
const LOGO_SHADOW = 'drop-shadow(0 1px 3px rgb(15 23 42 / 0.35))'

/**
 * The photo's own band, above the rows.
 *
 * Fixed rather than natural so that turning the lockup off does NOT move
 * everything below it. The toggle is a decision about what sits over the
 * photograph, not about how much photograph there is — if the rows jumped up
 * 120px when the lockup went away, a trainer would reasonably read that as the
 * setting having done something else as well. It also stops the empty state
 * reading as a gap where something failed to load: with the lockup off this is
 * a clean band of their own photo, at exactly the height it always was.
 *
 * 124px is what the lockup naturally occupies (12 top + 80 logo + 10 + ~18).
 */
const BAND = 'min-h-[124px]'

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
  showLockup,
  logoUrl,
  businessName,
  firstName,
  greeting,
  children,
}: {
  /** The trainer's uploaded background photo, or null for none. */
  imageUrl: string | null
  /**
   * Company-wide choice: does the business lockup — the logo AND the greeting
   * line under it — sit over the image at all? Karl asked for "whether they
   * want their logo and words there or not", and the words are the greeting, so
   * the two travel together rather than the greeting outliving the logo.
   */
  showLockup: boolean
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

      {/* The lockup — logo and greeting together, or neither. Skipped entirely
          when there is nothing to show AND no photo to reserve a band for, so a
          trainer with neither doesn't get an orphaned 20px margin. */}
      {(showLockup || image) && (
        <div
          className={cn(
            'relative mb-5 flex flex-col items-center justify-center pt-3',
            image && BAND,
          )}
        >
          {showLockup && (
            <>
              {logoUrl ? (
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
              )}
              <p
                className={cn(
                  'mt-2.5 text-[13px]',
                  image ? 'font-medium text-white' : 'text-slate-500',
                )}
              >
                Good {greeting}{firstName ? `, ${firstName}` : ''}
              </p>
            </>
          )}
        </div>
      )}

      {/* The rows and tiles. This wrapper's height IS the fade's height — see
          the note at the top of the file. */}
      <div className="relative">
        {image && (
          <div
            aria-hidden
            data-testid="home-hero-fade"
            className="pointer-events-none absolute -inset-x-4 inset-y-0"
            style={{ background: FADE_CSS }}
          />
        )}
        <div className="relative">{children}</div>
      </div>
    </div>
  )
}
