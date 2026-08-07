import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The shape of an edit screen, held still.
 *
 * Karl asked for this layout on the product form and then, in the same breath,
 * for it everywhere: "I want to reuse this layout for the offerings as well. or
 * achievements etc". A layout that is a shared component is a layout; four
 * hand-rolled copies of it are four screens that will drift. So these pin the
 * decisions the copies would get wrong.
 */
const src = (rel: string) => readFileSync(resolve(__dirname, '../../src/', rel), 'utf8')

const editScreen = src('components/shared/edit-screen.tsx')
const productForm = src('app/(trainer)/products/product-form.tsx')
const productDetail = src('app/(trainer)/products/[productId]/product-detail.tsx')

describe('the actions pin to the bottom of the screen', () => {
  it('sticks rather than fixes, so it cannot fight the desktop sidebar', () => {
    // The form's old comment refused a bottom bar because it "has to dodge the
    // desktop sidebar and the phone's safe area". Both are problems with
    // `fixed`, which is measured against the viewport; `sticky` is measured
    // against this column, which the shell has already inset past the rail.
    expect(editScreen).toMatch(/sticky bottom-0/)
    expect(editScreen).not.toMatch(/fixed (inset-x-0 )?bottom-0/)
  })

  it('clears the home indicator on a phone', () => {
    expect(editScreen).toContain('env(safe-area-inset-bottom, 0px)')
  })

  it('reclaims the room the shell reserves for the bottom tabs', () => {
    // The screen is immersive, so those tabs are not there to reserve room for
    // — left alone it is a band of nothing under the action bar.
    expect(editScreen).toMatch(/\.pm-main \{ padding-bottom: 0 !important; \}/)
  })
})

describe('the buttons are reachable and have names', () => {
  it('Cancel and Save are 44px tall and labelled', () => {
    // aria-label as well as the visible word: the label is what a screen reader
    // and voice control read, and "tap Save" only works if they match.
    expect(editScreen).toMatch(/aria-label=\{secondary\.label\}/)
    expect(editScreen).toMatch(/aria-label=\{primary\.label\}/)
    expect(editScreen.match(/className="h-11[^"]*"/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('Cancel is a bordered button, not a bare glyph', () => {
    // Next to a filled Save, a ghost icon at 44px reads as disabled — which is
    // the one thing the way out of a form must not do.
    expect(editScreen).toMatch(/variant="secondary"[\s\S]{0,200}aria-label=\{secondary\.label\}/)
  })

  it('Save stays the primary button and keeps its loading and disabled states', () => {
    expect(editScreen).toMatch(/loading=\{primary\.loading\}/)
    expect(editScreen).toMatch(/disabled=\{primary\.disabled\}/)
    // The spinner replaces the tick rather than standing beside it.
    expect(editScreen).toMatch(/\{!primary\.loading && primary\.icon\}/)
  })

  it('the ⋯ opens the shared sheet, not a menu hanging off a corner', () => {
    expect(editScreen).toContain('ActionSheet')
    expect(editScreen).not.toMatch(/absolute right-0 (top|mt)/)
    // 44px, and it says what it is for.
    expect(editScreen).toMatch(/aria-label=\{menuTitle \? `More actions for \$\{menuTitle\}` : 'More actions'\}/)
  })

  it('picking from the ⋯ closes it, so a confirm cannot open behind it', () => {
    expect(editScreen).toMatch(/setMenuOpen\(false\); a\.onSelect\(\)/)
  })
})

describe('the product form is the screen that proves it', () => {
  it('renders through EditScreen rather than its own chrome', () => {
    expect(productForm).toContain("from '@/components/shared/edit-screen'")
    expect(productForm).toContain('<EditScreen')
    // The old top row of actions is gone — it is the bottom bar's job now.
    expect(productForm).not.toMatch(/sticky top-\[/)
  })

  it('Preview lives in the ⋯ and nowhere else', () => {
    // Karl said it twice: "preview should be in the 3 dots".
    expect(productForm).not.toMatch(/<a[^>]*href=\{`\/products\/\$\{draft\.id\}\/preview`\}/)
    expect(productForm).toMatch(/key: 'preview'/)
    // A new tab, because Preview renders what is SAVED — navigating there from
    // a form with unsaved edits would throw them away to show the old version.
    expect(productForm).toMatch(/window\.open\(`\/products\/\$\{draft\.id\}\/preview`, '_blank'/)
  })

  it('offers nothing that needs a saved product before there is one', () => {
    expect(productForm).toMatch(/menu=\{isNew \? undefined : menuActions\}/)
  })

  it('uses the house pill tabs the offering screens use', () => {
    // Karl pointed at the offering detail screen — "here is an example" — when
    // he asked for this layout. This was a flat underline row, which is the
    // LIST style.
    expect(productDetail).toContain('OfferingTabs')
    expect(productDetail).not.toContain('border-b-2')
  })
})

/**
 * The second adopter was a READ screen, which is the test a shared layout has
 * to pass: an offering you are LOOKING at, whose primary action is Edit and
 * which has no Cancel at all — the way out is the back arrow the header
 * already carries (Karl: "this should have the same view as product").
 */
describe('a read screen fits the same shell', () => {
  const packageDetail = src('app/(trainer)/packages/[packageId]/package-detail.tsx')
  const offeringActions = src('components/trainer/offering-actions.tsx')

  it('takes a primary that navigates instead of submitting', () => {
    expect(editScreen).toMatch(/href\?: string/)
    // A real <a>: it middle-clicks, opens in a new tab and shows its target,
    // which a button that calls router.push does not.
    // `!primary ? null :` guards it — a tab can have no action at all (the
    // automation timeline), and the bar still draws for the ⋯ .
    expect(editScreen).toMatch(/\{!primary \? null : primary\.href \? \(/)
    expect(editScreen).toMatch(/<Link\s+href=\{primary\.href\}/)
  })

  it('the offering screen passes a primary that follows the tab, and no secondary', () => {
    // Edit stays the primary on Details — it's the package you're looking at.
    // On Clients and Sessions it offered to edit the package while you were
    // looking at who's enrolled or what each session covers, so those get
    // "Add" instead (Karl, 2026-08-07: "this tab should not have edit, it
    // should have add to enrol the client" / "the sessions tab should have an
    // add button"). Editing is still one tap away in the ⋯ .
    expect(packageDetail).toMatch(/label: 'Edit', href: editHref/)
    expect(packageDetail).toMatch(/tab === 'clients'/)
    expect(packageDetail).toMatch(/setPickingClient\(true\)/)
    // Sessions is NOT in this list any more: its Add sits directly above the
    // list it adds to (Karl, 2026-08-07: "put the add button above the
    // sessions list"), rather than in the pinned bar.
    expect(packageDetail).toMatch(/<AddSessionButton/)
    // Still no Cancel: nothing is being edited, and the way out is the back
    // arrow the header already carries.
    expect(packageDetail).not.toMatch(/secondary=\{/)
  })

  it('its actions come from the shared hook, not a second copy', () => {
    // The routes, the confirmations and the refusal prose have ONE copy; the
    // two callers decide only where they are drawn. A `variant` prop on the
    // component would have been the other way, and that is how the offering
    // card ended up crushing its title on a phone.
    expect(offeringActions).toContain('export function useOfferingActions')
    expect(offeringActions).toContain('export function OfferingActions')
    expect(packageDetail).toContain('useOfferingActions({')
    // <OfferingActions> IS drawn again — on the Details card, desktop only
    // (Karl: "put the edit and the ... button like it was"). What matters is
    // that both the card and the pinned bar are fed by the same hook, so the
    // routes and confirmations can't drift apart.
    expect(packageDetail).toMatch(/<OfferingActions\b/)
  })

  it('draws Edit and the heading on the card at desktop width only', () => {
    // Edit and More used to float in the details card's own heading row. They
    // are the SCREEN's actions, so they live in the pinned bar — asserted by
    // the primary test above. The heading that replaced them has since gone
    // too (Karl, 2026-08-07: "we should not see the 'details' title on the
    // page" — the selected tab already says Details), so what's left to hold
    // is simply that neither came back into the card.
    // Both are back on desktop, and both are hidden on a phone — where the
    // tab above already says "Details" and the actions are pinned to the foot.
    expect(packageDetail).toMatch(/<div className="hidden md:block">/)
    expect(packageDetail).toMatch(/<CardHeading[\s\S]{0,80}icon=\{<Info /)
  })
})

describe('achievements, the third adopter', () => {
  const form = src('app/(trainer)/achievements/achievement-form.tsx')

  it('renders through EditScreen and drops its own sticky row', () => {
    expect(form).toContain('<EditScreen')
    expect(form).not.toMatch(/sticky bottom-0/)
  })

  it('moves Delete into the ⋯ behind the house confirm sheet', () => {
    // It was a grey line of text under the last field that turned into two
    // buttons in place: quiet enough to miss, and once found, one tap from
    // gone. Every other offering asks in the same sheet.
    expect(form).toMatch(/key: 'delete'/)
    expect(form).toContain('<ConfirmSheet')
    expect(form).not.toContain('Confirm delete')
  })

  it('keeps the disabled and loading states on Save', () => {
    expect(form).toMatch(/loading: saving/)
    expect(form).toMatch(/disabled: !name\.trim\(\)/)
  })
})
