import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * A page that will not scroll, with nothing on screen to say why.
 *
 * Karl, 2026-08-06, on /settings?tab=configure. The cause was the create
 * circle: it locks `document.body.overflow` while its full screen is open, and
 * the lock's cleanup only runs when that flag flips or the component unmounts.
 * The circle does not unmount when you navigate — the shell keeps it mounted —
 * and once it became home-only it simply rendered nothing everywhere else. So
 * an open screen that a navigation hid stayed "open" forever, and every page
 * after it inherited `overflow: hidden`.
 *
 * The rule this pins: a lock must be keyed on whether the thing is SHOWING, not
 * on a flag that can outlive it. Hidden is closed.
 */
const src = (rel: string) => readFileSync(resolve(__dirname, '../../src/', rel), 'utf8')

const fab = src('components/shared/floating-create-button.tsx')

describe('the create circle cannot leave the page locked', () => {
  it('derives "showing" from the flag AND whether it is on screen at all', () => {
    expect(fab).toMatch(/const showingScreen = open && !hideOnPhone/)
  })

  it('keys the body-scroll lock on showing, never on the raw flag', () => {
    const effect = fab.slice(fab.indexOf('if (!showingScreen) return'))
    expect(fab).toContain('if (!showingScreen) return')
    expect(effect).toContain("document.body.style.overflow = 'hidden'")
    // The dependency matters as much as the guard: keyed on `open`, the effect
    // never re-runs when the screen is hidden, so the cleanup never fires.
    expect(effect).toMatch(/\}, \[showingScreen\]\)/)
    expect(fab).not.toMatch(/document\.body\.style\.overflow = 'hidden'[\s\S]{0,400}\}, \[open\]\)/)
  })

  it('clears the flag when the circle goes away', () => {
    expect(fab).toMatch(/if \(hideOnPhone\) \{ setOpen\(false\); setSaleOpen\(false\) \}/)
  })

  it('renders the screen only while it is meant to be showing', () => {
    // It sits OUTSIDE the block that hides the button, so an orphaned `open`
    // would have painted a create screen over whatever page you landed on.
    expect(fab).toMatch(/\{showingScreen && \(/)
    expect(fab).not.toMatch(/\{open && \(\s*\n\s*<ModalPortal>/)
  })
})

describe('the other body-scroll lockers, checked for the same shape', () => {
  // The bug needs three things at once: a lock keyed on state, a component that
  // stays MOUNTED while the thing it locks for is hidden, and nothing resetting
  // that state. These four unmount when they close — their cleanup is the
  // unmount — so the middle condition cannot hold.
  const UNMOUNT_WHEN_CLOSED = [
    'components/shared/action-sheet.tsx',
    'components/shared/full-screen-sheet.tsx',
    'components/shared/confirm-sheet.tsx',
    'components/shared/propose-time-sheet.tsx',
    'components/shared/membership-consent-screen.tsx',
  ]

  it.each(UNMOUNT_WHEN_CLOSED)('%s locks on mount and restores on unmount', rel => {
    const file = src(rel)
    expect(file).toContain("document.body.style.overflow = 'hidden'")
    // No state guard = no way for the lock to outlive the component.
    expect(file).not.toMatch(/useEffect\(\(\) => \{\s*\n?\s*if \(!\w*[Oo]pen\) return[\s\S]{0,300}document\.body\.style\.overflow = 'hidden'/)
  })

  it('the phone search unmounts on an immersive page rather than hiding', () => {
    // Its lock IS keyed on state (searchOpen) and it does stay mounted across
    // navigations — but the shell removes it from the tree entirely when a page
    // turns immersive, which runs the cleanup. Were this ever changed to a CSS
    // hide, it would become the create circle's bug.
    const shell = src('components/shared/app-shell.tsx')
    expect(shell).toMatch(/\{!immersive && \([\s\S]{0,600}variant="search"/)
  })
})
