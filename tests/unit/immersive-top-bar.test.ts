import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * "Immersive" must not mean "no header".
 *
 * A page turns immersive to get the bottom tabs and the global "+" out of the
 * way while it is being filled in (Karl, 2026-08-06: "when creating a product
 * these should not be there its confusing"). The shell read that as licence to
 * hide its whole phone top bar — reasoning written for a message thread, which
 * brings a header of its own — and the product form was left with no name, no
 * back arrow and no way out but the browser ("the header should always be
 * there", same day, with a screenshot of the gap).
 *
 * So the two questions are separate now, and these hold them apart:
 *   • the page says whether it keeps the bar (keepTopBar), and
 *   • the bar it keeps loses its NAVIGATION — search and menu — not its
 *     identity: back + the name of the thing being edited.
 *
 * Source-reading, like the other UI rules in this suite: there is no DOM
 * environment here, and the thing worth pinning is the wiring rather than the
 * pixels (those are measured in the browser at 394px).
 */
const src = (rel: string) => readFileSync(resolve(__dirname, '../../src/', rel), 'utf8')

const shell = src('components/shared/app-shell.tsx')
const pageTitle = src('components/shared/page-title.tsx')
const productForm = src('app/(trainer)/products/product-form.tsx')
const messages = src('app/(trainer)/messages/messages-view.tsx')

/** The body of TrainerMobileHeader, which is the bar this is all about. */
function mobileHeaderSource() {
  const start = shell.indexOf('function TrainerMobileHeader(')
  expect(start).toBeGreaterThan(-1)
  const end = shell.indexOf('\nfunction ', start + 1)
  return shell.slice(start, end)
}

describe('the phone top bar survives an immersive page', () => {
  it('is not wrapped in HideWhenImmersive — that is what removed it entirely', () => {
    // The exact shape of the regression: <HideWhenImmersive><TrainerMobileHeader/>.
    expect(shell).not.toMatch(/<HideWhenImmersive>\s*(\{[^}]*\}\s*)*<TrainerMobileHeader/)
    expect(shell).toMatch(/<TrainerMobileHeader\b/)
  })

  it('hides itself only for a page that brings its own header', () => {
    // Both halves of the condition matter. Without keepsTopBar every immersive
    // page loses its header (the bug); without immersive nothing ever hides and
    // the message thread grows a second one.
    expect(mobileHeaderSource()).toMatch(/if\s*\(immersive\s*&&\s*!keepsTopBar\)\s*return null/)
  })

  it('reads immersive BELOW the provider, in the header, not in TrainerShell', () => {
    // TrainerShell renders PageTitleProvider, so a usePageImmersive() call in
    // its own body sits above the provider and always reads `false`. This has
    // been a real bug once already.
    const header = mobileHeaderSource()
    expect(header).toContain('usePageImmersive()')
    expect(header).toContain('usePageImmersiveKeepsTopBar()')
    const shellBody = shell.slice(shell.indexOf('function TrainerShell('))
    const untilProvider = shellBody.slice(0, shellBody.indexOf('<PageTitleProvider>'))
    expect(untilProvider).not.toContain('usePageImmersive')
  })
})

describe('what the immersive bar keeps and drops', () => {
  const header = mobileHeaderSource()

  it('drops search and the global "+" — both offer to start something else', () => {
    const gated = header.slice(header.indexOf('{!immersive && ('))
    expect(header).toContain('{!immersive && (')
    expect(gated).toContain('<FloatingCreateButton')
    expect(gated).toContain('variant="search"')
  })

  it('keeps the page name and the back slot unconditionally', () => {
    expect(header).toContain('id="pm-topbar-back-mobile"')
    expect(header).toContain('id="pm-topbar-actions-mobile"')
    expect(header).toMatch(/<h1[\s\S]*?showTitle \? title : businessName/)
  })

  it('never leaves a phone with nothing to press', () => {
    // Menu is suppressed by a BACK ARROW, never by immersive: with the tabs
    // gone, an immersive page that forgot to portal a back arrow would
    // otherwise be a screen with no control on it at all.
    expect(header).toMatch(/\{!hasBack && \(/)
    expect(header).not.toMatch(/\{!hasBack && !immersive/)
    expect(header).not.toMatch(/immersive && !hasBack.*Menu/s)
  })

  it('gives that back arrow a 44px target on a phone', () => {
    // It is the only way out of an immersive screen, so it is thumb-sized —
    // the same 44px as the Menu button it stands in for.
    expect(src('components/shared/page-header-portal.tsx')).toMatch(/const mobCls = '[^']*h-11 w-11/)
  })
})

describe('a page declares which kind of takeover it is', () => {
  it('SetPageImmersive takes keepTopBar, defaulting to the old behaviour', () => {
    expect(pageTitle).toMatch(/SetPageImmersive\(\{ value, keepTopBar = false \}/)
    expect(pageTitle).toContain('usePageImmersiveKeepsTopBar')
  })

  it('the product form keeps the bar — it has no header of its own', () => {
    expect(productForm).toMatch(/<SetPageImmersive value keepTopBar \/>/)
  })

  it('the message thread does not — it renders its own header', () => {
    expect(messages).toMatch(/<SetPageImmersive value=\{rightPaneOpen\} \/>/)
    expect(messages).not.toContain('keepTopBar')
  })
})

describe('a page that is not immersive is untouched', () => {
  it('the bottom tab bar still only stands down for immersive pages', () => {
    expect(shell).toContain('<HideWhenImmersive>')
    expect(shell).toMatch(/function HideWhenImmersive[\s\S]*usePageImmersive\(\) \? null/)
  })

  it('the "+" still reads the flag itself, wherever it is rendered', () => {
    // It portals to <body>, so it can outlive the row that renders it.
    expect(src('components/shared/floating-create-button.tsx')).toContain('const immersive = usePageImmersive()')
  })
})
