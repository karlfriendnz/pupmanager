/**
 * Legibility guard for the membership storefront card's call-to-action button.
 *
 * A trainer picks a button background and a button text colour. Nothing stops
 * them picking white-on-pastel, so we never paint the raw pair: the text tone is
 * derived from their choice by mixing it toward #0f172a (or #ffffff on a dark
 * button) until it clears WCAG AA 4.5:1 against the background — the same
 * `color-mix(in srgb, …)` move the house style asks for, computed here so we can
 * actually measure the result.
 *
 * Server-safe (no DOM), so the client cards, the trainer preview and the tests
 * all agree on what a given pair renders as.
 */

/** WCAG AA for normal-size body text. */
export const MIN_CONTRAST = 4.5

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export type Rgb = [number, number, number]

/** `#abc` / `#aabbcc` → [r,g,b] (0-255). Null for anything else. */
export function parseHex(hex: string | null | undefined): Rgb | null {
  if (!hex || !HEX_RE.test(hex.trim())) return null
  let h = hex.trim().slice(1)
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function toHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

/** WCAG relative luminance. */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(v => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colours (1 – 21). Invalid input → 1. */
export function contrastRatio(a: string, b: string): number {
  const ra = parseHex(a), rb = parseHex(b)
  if (!ra || !rb) return 1
  const la = relativeLuminance(ra), lb = relativeLuminance(rb)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * `color-mix(in srgb, colour <weight>%, target)` computed in JS.
 * weight = how much of `colour` survives (100 = untouched, 0 = pure target).
 */
export function mixToward(colour: string, target: string, weight: number): string {
  const c = parseHex(colour), t = parseHex(target)
  if (!c || !t) return colour
  const w = Math.max(0, Math.min(100, weight)) / 100
  return toHex([0, 1, 2].map(i => c[i] * w + t[i] * (1 - w)) as Rgb)
}

// The two poles every derived tone is pulled toward — house ink and paper.
const INK = '#0f172a'
const PAPER = '#ffffff'

export const DEFAULT_FEATURED = '#7c3aed'

export interface ButtonColors {
  /** Hex to paint the button background with. */
  background: string
  /** Hex to paint the label with — legible against `background`, guaranteed. */
  color: string
  /** True when the trainer's text choice had to be darkened/lightened to be readable. */
  adjusted: boolean
  /** Contrast ratio actually rendered. */
  ratio: number
}

/**
 * Resolve the button's rendered colours from what the trainer saved.
 *
 * - background falls back to the card's featured colour, then the app default.
 * - text falls back to whichever of ink/paper reads best on that background.
 * - a text colour that can't clear 4.5:1 is mixed toward ink (light button) or
 *   paper (dark button) in 10% steps until it does, keeping their hue as far as
 *   the standard allows.
 */
export function resolveButtonColors(
  buttonBgColor: string | null | undefined,
  buttonTextColor: string | null | undefined,
  featuredColor: string | null | undefined,
): ButtonColors {
  const background = parseHex(buttonBgColor) ? buttonBgColor!.trim()
    : parseHex(featuredColor) ? featuredColor!.trim()
    : DEFAULT_FEATURED

  // Which pole is the safe direction on this background?
  const bgIsDark = contrastRatio(background, PAPER) >= contrastRatio(background, INK)
  const pole = bgIsDark ? PAPER : INK

  const wanted = parseHex(buttonTextColor) ? buttonTextColor!.trim() : pole
  const startRatio = contrastRatio(background, wanted)
  if (startRatio >= MIN_CONTRAST) return { background, color: wanted, adjusted: false, ratio: startRatio }

  for (let weight = 90; weight >= 0; weight -= 10) {
    const candidate = mixToward(wanted, pole, weight)
    const ratio = contrastRatio(background, candidate)
    if (ratio >= MIN_CONTRAST) return { background, color: candidate, adjusted: true, ratio }
  }

  // A mid-tone background can be too muddy for either pole to clear 4.5:1 — take
  // the best available rather than rendering something unreadable.
  const best = contrastRatio(background, PAPER) >= contrastRatio(background, INK) ? PAPER : INK
  return { background, color: best, adjusted: true, ratio: contrastRatio(background, best) }
}
