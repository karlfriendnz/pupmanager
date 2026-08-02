import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The photo behind the top of the trainer's home, and the fade that removes it.
//
// It was specified by where the fade STARTS and ENDS, not by how tall it is:
// clean at the top of the run of rows and tiles, completely gone by the bottom
// of that same run. Those rows change height constantly — a booking request
// arrives, the review strip opens, a groomer's trade gives them four tiles
// instead of six — so any fixed height, and any height measured in an effect,
// is wrong the moment the screen changes. This file pins the structural
// property that makes the fade correct without measuring anything.
const hero = readFileSync('src/components/shared/home-hero.tsx', 'utf8')
const mobile = readFileSync('src/app/(trainer)/dashboard/mobile-home.tsx', 'utf8')
const globals = readFileSync('src/app/globals.css', 'utf8')
const rootLayout = readFileSync('src/app/layout.tsx', 'utf8')
const card = readFileSync('src/app/(trainer)/settings/home-image-card.tsx', 'utf8')

describe('the fade is anchored to the rows, not to a number', () => {
  it('sizes itself off the children wrapper with inset-0 — no height, no measurement', () => {
    // absolute inset-0 of the wrapper that contains {children} means its height
    // IS the rows' height, resolved by the browser at paint, correct on the
    // server render, and correct again the next time the rows grow.
    expect(hero).toContain('className="pointer-events-none absolute -inset-x-4 inset-y-0"')
    // The alternative that was rejected. If any of these appear, someone has
    // gone back to measuring.
    expect(hero).not.toContain('useRef')
    expect(hero).not.toContain('useEffect')
    expect(hero).not.toContain('ResizeObserver')
    expect(hero).not.toContain('getBoundingClientRect')
  })

  it('runs from fully transparent at the top to fully opaque at the bottom', () => {
    expect(hero).toContain('linear-gradient(to bottom, rgb(var(--pm-page-bg-rgb) / 0) 0%')
    expect(hero).toContain('rgb(var(--pm-page-bg-rgb) / 1) 100%)')
  })

  it('fades to the page background TOKEN, not a hardcoded slate-50', () => {
    // A literal #f8fafc here bands against the page the day the background is
    // retuned, and nobody would connect the two changes.
    expect(hero).not.toMatch(/#f8fafc/i)
    // Scoped to the gradient itself — white DOES appear elsewhere in the file,
    // as the halo that keeps the greeting readable over a dark photo.
    const fade = hero.slice(hero.indexOf('const FADE'), hero.indexOf('const HALO'))
    expect(fade).not.toContain('255 255 255')
    expect(fade).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('never writes bare `transparent` in the gradient', () => {
    // Safari interpolates `transparent` through transparent BLACK, which leaves
    // a grey bruise across the middle of the fade.
    expect(hero).not.toMatch(/linear-gradient\([^)]*\btransparent\b/)
  })
})

describe('the page background is one token', () => {
  it('defines --pm-page-bg-rgb once, as bare channels', () => {
    expect(globals).toContain('--pm-page-bg-rgb: 248 250 252')
    expect(globals).toContain('--pm-page-bg: rgb(var(--pm-page-bg-rgb))')
  })

  it('paints <body> from that same token, so the two cannot drift', () => {
    expect(rootLayout).toContain('bg-[var(--pm-page-bg)]')
    expect(rootLayout).not.toContain('bg-slate-50')
  })
})

describe('the image covers the lockup as well as the rows', () => {
  it('spans the whole hero and bleeds past the dashboard’s p-4', () => {
    // 16px of page down each side would read as a picture in a box rather than
    // a background, so both layers cancel the container's padding identically.
    expect(hero).toContain('absolute -inset-x-4 -top-5 bottom-0 bg-cover bg-center')
  })

  it('escapes the URL where it is pasted into CSS', () => {
    expect(hero).toContain('function cssUrl')
    expect(hero).toContain("url(\"${url.replace")
  })
})

describe('legibility over a photograph nobody has seen', () => {
  // The rows and tiles are opaque white blocks, so only the logo and greeting
  // sit directly on the photo. Rather than dim the image — the one thing the
  // trainer asked to see at full strength — those two carry their own contrast.
  it('gives the greeting a white halo and the logo a drop shadow', () => {
    expect(hero).toContain('textShadow: HALO')
    expect(hero).toContain('filter: LOGO_SHADOW')
    // Stacked, with the innermost ring fully opaque — a single soft glow was
    // measured against a real photo and left the greeting uncomfortably tight
    // over dark hair.
    expect(hero).toContain("'0 0 3px rgb(255 255 255)'")
    expect(hero).toContain("'0 0 6px rgb(255 255 255)'")
  })

  it('applies neither when there is no image', () => {
    expect(hero).toContain('style={image ? { textShadow: HALO } : undefined}')
    expect(hero).toContain('style={image ? { filter: LOGO_SHADOW } : undefined}')
  })
})

describe('the logo is the company’s choice, not the app’s', () => {
  it('hides the lockup but keeps the greeting when it is off', () => {
    expect(hero).toContain('{showLogo && (logoUrl ? (')
    // The greeting is outside that conditional — it always renders.
    const greeting = hero.indexOf('Good {greeting}')
    const lockupEnd = hero.indexOf('))}')
    expect(greeting).toBeGreaterThan(lockupEnd)
  })

  it('keeps the photo something to look at when the logo is off', () => {
    expect(hero).toContain("image && !showLogo && 'min-h-[104px] justify-end pb-1'")
  })
})

describe('the trainer’s home uses it, and so does the preview', () => {
  it('wraps the rows and tiles — the “red box” — in the hero', () => {
    expect(mobile).toContain('<HomeHero')
    const open = mobile.indexOf('<HomeHero')
    const grid = mobile.indexOf('grid grid-cols-2 overflow-hidden rounded-xl')
    const close = mobile.indexOf('</HomeHero>')
    expect(grid).toBeGreaterThan(open)
    expect(close).toBeGreaterThan(grid)
  })

  it('reads both settings off the company profile, not the member', () => {
    const page = readFileSync('src/app/(trainer)/dashboard/page.tsx', 'utf8')
    expect(page).toContain('homeHeroImageUrl: true, homeHeroShowLogo: true')
    expect(page).toContain('heroImageUrl={brandingProfile?.homeHeroImageUrl ?? null}')
    // Default ON — every existing account already has the lockup on its home.
    expect(page).toContain('heroShowLogo={brandingProfile?.homeHeroShowLogo ?? true}')
  })

  it('previews the REAL hero rather than a drawing of it', () => {
    // A hand-drawn mock-up in Settings is a second implementation of the fade;
    // the first time either changes the preview starts lying.
    expect(card).toContain("import { HomeHero } from '@/components/shared/home-hero'")
    expect(card).toContain('<HomeHero')
  })

  it('previews the UNSAVED state, so it is useful while deciding', () => {
    expect(card).toContain('imageUrl={imageUrl}')
    expect(card).toContain('showLogo={showLogo}')
  })

  it('compresses before uploading', () => {
    // A raw 12 MP phone photo is exactly what a trainer reaches for here, and
    // it blows past the ~4.5 MB serverless body limit.
    expect(card).toContain('await compressImageFile(file)')
    const compress = card.indexOf('compressImageFile(file)')
    const post = card.indexOf("fetch('/api/trainer/branding-image'")
    expect(post).toBeGreaterThan(compress)
  })
})
