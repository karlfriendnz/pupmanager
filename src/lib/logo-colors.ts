// Browser-only: pull a small brand palette out of an uploaded logo so the
// onboarding wizard can pre-fill the trainer's app gradient + email accent.
// Runs entirely client-side off the picked File (same-origin object URL), so
// the canvas is never tainted by the cross-origin Blob URL.

export type LogoPalette = { start: string; end: string; accent: string }

type Swatch = { r: number; g: number; b: number; count: number; sat: number }

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
const toHex = (c: { r: number; g: number; b: number }) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`
const darken = (c: { r: number; g: number; b: number }, amt: number) =>
  toHex({ r: c.r * (1 - amt), g: c.g * (1 - amt), b: c.b * (1 - amt) })
const dist = (a: Swatch, b: Swatch) =>
  Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)

// Sample the logo down to a small canvas, histogram the colours (ignoring the
// transparent / near-white / near-black background), and return the most
// prominent colourful swatches as a gradient + accent.
export async function extractLogoColors(file: File): Promise<LogoPalette | null> {
  if (typeof document === 'undefined') return null
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, size, size)
    const { data } = ctx.getImageData(0, 0, size, size)

    // Quantize to 4 bits/channel and accumulate per bucket.
    const buckets = new Map<string, { count: number; r: number; g: number; b: number }>()
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
      if (a < 128) continue // transparent background
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      if (max > 244 && min > 232) continue // near-white background
      if (max < 26) continue // near-black
      const key = `${r >> 4}-${g >> 4}-${b >> 4}`
      const cur = buckets.get(key)
      if (cur) { cur.count++; cur.r += r; cur.g += g; cur.b += b }
      else buckets.set(key, { count: 1, r, g, b })
    }
    if (buckets.size === 0) return null

    const swatches: Swatch[] = [...buckets.values()].map(c => {
      const r = c.r / c.count, g = c.g / c.count, b = c.b / c.count
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const sat = max === 0 ? 0 : (max - min) / max
      return { r, g, b, count: c.count, sat }
    })

    // Rank by prominence, biased toward colourful (so a mostly-grey logo with a
    // pop of colour still surfaces the colour).
    const byProminence = [...swatches].sort((a, b) => b.count * (0.35 + b.sat) - a.count * (0.35 + a.sat))
    const primary = byProminence[0]
    // A second, visually distinct colour for the gradient end — else darken.
    const second = byProminence.find(s => dist(s, primary) > 60) ?? null
    // Email accent: the most saturated prominent colour.
    const vivid = [...swatches].sort((a, b) => b.sat * b.count - a.sat * a.count)[0] ?? primary

    return {
      start: toHex(primary),
      end: second ? toHex(second) : darken(primary, 0.16),
      accent: toHex(vivid),
    }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}
