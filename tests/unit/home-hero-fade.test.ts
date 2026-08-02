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

/** The gradient's stop list, and the greeting's shadow, as written in source. */
const FADE_STOPS = hero
  .slice(hero.indexOf('const FADE = ['), hero.indexOf('const FADE_CSS'))
  .split('\n')
  .filter(l => l.includes('rgb('))
const GREETING_SHADOW_SRC = hero
  .split('\n')
  .find(l => l.startsWith('const GREETING_SHADOW')) ?? ''

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
    expect(hero).toContain("'rgb(var(--pm-page-bg-rgb) / 0) 0%'")
    expect(hero).toContain("'rgb(var(--pm-page-bg-rgb) / 1) 100%'")
  })

  it('reaches full opacity BEFORE the end, so the image has no visible seam', () => {
    // The image layer stops dead at the bottom of the rows. If the gradient is
    // still short of opaque when it gets there, the photo is faintly visible
    // right up to its last pixel and then simply ends — a hard horizontal line
    // across the screen, level with the bottom of the tiles. Karl saw it.
    expect(hero).toContain("'rgb(var(--pm-page-bg-rgb) / 1) 88%'")
    const solid = FADE_STOPS.filter(s => s.includes('/ 1)'))
    expect(solid.length).toBeGreaterThanOrEqual(2)
  })

  it('fades to the page background TOKEN, not a hardcoded slate-50', () => {
    // A literal #f8fafc here bands against the page the day the background is
    // retuned, and nobody would connect the two changes.
    expect(hero).not.toMatch(/#f8fafc/i)
    // Scoped to the gradient itself — white DOES appear elsewhere in the file,
    // as the halo that keeps the greeting readable over a dark photo.
    const fade = hero.slice(hero.indexOf('const FADE = ['), hero.indexOf('const FADE_CSS'))
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
  it('uses white type with a DARK halo, which works over light and dark alike', () => {
    expect(hero).toContain('textShadow: GREETING_SHADOW')
    expect(hero).toContain('filter: LOGO_SHADOW')
    expect(hero).toContain("image ? 'font-medium text-white' : 'text-slate-500'")
  })

  it('never stacks wide white glows again', () => {
    // Three stacked opaque WHITE glows accumulate into a solid plate the size
    // of the text, which over a pale sky reads as a grey rectangle behind the
    // words. It fixed the dark-hair case and broke the bright-sky one.
    expect(GREETING_SHADOW_SRC).not.toContain('255 255 255')
    expect(GREETING_SHADOW_SRC.match(/rgb\(/g)?.length ?? 0).toBeLessThanOrEqual(2)
  })

  it('applies neither when there is no image', () => {
    expect(hero).toContain('style={image ? { textShadow: GREETING_SHADOW } : undefined}')
    expect(hero).toContain('style={image ? { filter: LOGO_SHADOW } : undefined}')
  })
})

describe('the lockup is the company’s choice, not the app’s', () => {
  // Karl: "by unticking 'show my logo' it should hide 'Good evening, demo' as
  // well". His original ask was "their logo AND WORDS", and the words are the
  // greeting — so the two travel together.
  it('hides the logo AND the greeting together', () => {
    const open = hero.indexOf('{showLockup && (')
    const greeting = hero.indexOf('Good {greeting}')
    expect(open).toBeGreaterThan(-1)
    // The greeting sits INSIDE the showLockup conditional, not after it.
    expect(greeting).toBeGreaterThan(open)
  })

  it('keeps the photo band the same height either way, so nothing jumps', () => {
    // The toggle decides what sits OVER the photo, not how much photo there is.
    // Rows leaping up 120px would read as the setting having done something
    // else as well, and an unexplained gap reads as a failed load.
    expect(hero).toContain("const BAND = 'min-h-[124px]'")
    expect(hero).toContain('image && BAND')
  })

  it('renders nothing at all with no lockup and no photo', () => {
    expect(hero).toContain('{(showLockup || image) && (')
  })

  it('says so on the label — it is not just the logo', () => {
    expect(card).toContain('Show my logo and greeting')
    expect(card).not.toContain('Show my logo on the home screen')
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
    expect(page).toContain('homeHeroImageUrl: true, homeHeroShowLockup: true')
    expect(page).toContain('heroImageUrl={brandingProfile?.homeHeroImageUrl ?? null}')
    // Default ON — every existing account already has the lockup on its home.
    expect(page).toContain('heroShowLockup={brandingProfile?.homeHeroShowLockup ?? true}')
  })

  it('previews the REAL hero rather than a drawing of it', () => {
    // A hand-drawn mock-up in Settings is a second implementation of the fade;
    // the first time either changes the preview starts lying.
    expect(card).toContain("import { HomeHero } from '@/components/shared/home-hero'")
    expect(card).toContain('<HomeHero')
  })

  it('previews the UNSAVED state, so it is useful while deciding', () => {
    expect(card).toContain('imageUrl={imageUrl}')
    expect(card).toContain('showLockup={showLockup}')
  })

  it('scales against the frame’s INNER width, not its outer width', () => {
    // border-box + a 9px bezel means a w-[228px] frame has a 210px screen.
    // Scaling 390 by 228/390 put 228px of content in a 210px box, so every row
    // and tile overhung the right bezel by 18px and was clipped. It looked
    // like the hero's -inset-x-4 bleed misbehaving; it was arithmetic.
    expect(card).toContain('const SCREEN_W = FRAME_OUTER_W - BEZEL * 2')
    expect(card).toContain('const SCALE = SCREEN_W / PHONE_W')
    expect(card).not.toContain('SCALE = FRAME_W / PHONE_W')
  })

  it('shows the real top bar, translucent and blurred like the shell’s', () => {
    // The photo tucks UNDER this bar. A solid white strip would misrepresent
    // the one thing a trainer is judging when they pick an image.
    expect(card).toContain('function PreviewTopBar')
    expect(card).toContain('bg-white/95 backdrop-blur')
    // Painted over the photo, not stacked above it in flow.
    expect(card).toContain('absolute inset-x-0 top-0 z-10')
    expect(card).toContain('paddingTop: TOPBAR_H + 16')
  })

  it('flags that top bar as a stand-in for the shell’s real one', () => {
    // It cannot be reused: private, duplicate portal ids, live context.
    expect(card).toContain('STAND-IN')
    expect(card).toContain('pm-topbar-actions-mobile')
  })

  it('carries six tiles, like the real home', () => {
    // Two tiles left the frame half empty AND squeezed the fade into a shorter
    // run than the trainer will ever see — wrong twice over.
    const tiles = card.slice(card.indexOf('const PREVIEW_TILES'), card.indexOf('function PreviewRows'))
    expect(tiles.match(/label:/g)?.length).toBe(6)
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
