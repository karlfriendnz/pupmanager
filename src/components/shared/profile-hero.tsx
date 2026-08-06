import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A full-bleed photo with the name of whoever it belongs to sitting in the
 * bottom-left of it.
 *
 * Written for the client app's home screen and then asked for again on the
 * trainer's client profile (Karl, 2026-08-06: "I really like the idea of the
 * client look and feel of the profile where it has a big image and then buttons
 * to do things"). Everything fiddly about it lives here once:
 *
 *   • **Two gradients, not one.** The top one keeps a status bar and any
 *     indicator dots readable over a bright photo; the bottom one is what makes
 *     white caption text legible over a photo nobody has seen yet. They are
 *     functional, not decoration.
 *   • **The caption is `pointer-events-none`.** It covers the lower third of
 *     the image, so without this it swallows taps meant for whatever sits
 *     underneath (an upload button on the client's own screen).
 *   • **A missing photo is a BANNER, not an empty state.** No dashed outline,
 *     no illustration standing in for the picture, no prompt — the screen must
 *     not restructure itself around whether someone uploaded a photo. Callers
 *     pass the tone; the house rule is to derive it with `color-mix` toward
 *     `#0f172a` so a pastel brand accent stays legible under white text, never
 *     the raw hex.
 */
export function ProfileHero({
  className,
  media,
  bannerStyle,
  eyebrow,
  title,
  chip,
  subtitle,
  overlay,
}: {
  /** Height/rounding/margins. The base is a 300px full-bleed block. */
  className?: string
  /**
   * The image layer — one `<img>`, a gallery, whatever. Omit it (or pass null)
   * and the hero becomes the banner.
   */
  media?: ReactNode
  /** The banner's fill, when there is no media. Defaults to a deepened accent. */
  bannerStyle?: CSSProperties
  /** Small uppercase line above the name. */
  eyebrow?: ReactNode
  title: ReactNode
  /** A status chip beside the title — it must not get lost in the photo. */
  chip?: ReactNode
  subtitle?: ReactNode
  /** Anything over the photo that has to be tappable. */
  overlay?: ReactNode
}) {
  return (
    <section
      className={cn('relative w-full h-[300px] overflow-hidden bg-accent-soft', className)}
      style={media ? undefined : (bannerStyle ?? DEFAULT_BANNER)}
    >
      {media}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/55 via-black/15 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
      <div
        className="pointer-events-none absolute bottom-8 left-5 right-5 z-10 text-white"
        style={{ textShadow: '0 1px 14px rgba(0,0,0,0.55)' }}
      >
        {eyebrow && <p className="text-[11px] uppercase tracking-wider font-semibold text-white/80">{eyebrow}</p>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="font-display text-3xl font-extrabold leading-tight">{title}</h1>
          {chip}
        </div>
        {subtitle && <p className="text-sm text-white/85">{subtitle}</p>}
      </div>
      {overlay}
    </section>
  )
}

// Deep enough that white text clears WCAG AA on ANY brand accent, including the
// pastels trainers actually pick. `color-mix` toward slate-900 rather than a
// hand-picked dark, so it still reads as their colour.
const DEFAULT_BANNER: CSSProperties = {
  background: 'color-mix(in srgb, var(--accent) 58%, #0f172a)',
}
