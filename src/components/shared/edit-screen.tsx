'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ActionSheet, type SheetAction } from '@/components/shared/action-sheet'
import { SetPageImmersive } from '@/components/shared/page-title'
import { cn } from '@/lib/utils'

/**
 * The shape every edit screen in the trainer app takes.
 *
 * Karl, 2026-08-06, after editing a product on a phone: "I want to reuse this
 * layout for the offerings as well. or achievements etc". So this is that
 * layout, written once, rather than a fourth screen that gets it nearly right:
 *
 *   ┌──────────────────────────────┐
 *   │ ←  Name of the thing         │  the shell's phone top bar, stripped
 *   ├──────────────────────────────┤
 *   │  ( Details )( Options )( … ) │  tabs, optional
 *   │                              │
 *   │  the form                    │
 *   │                              │
 *   ├──────────────────────────────┤
 *   │  ⋯      Cancel        Save   │  pinned, always reachable
 *   └──────────────────────────────┘
 *
 * Three decisions worth knowing before you change one of them.
 *
 * **It declares itself immersive.** Filling something in is one job: the five
 * bottom tabs and the floating "+" both offer to start something ELSE
 * mid-sentence ("these should not be there its confusing"). keepTopBar, so the
 * shell's phone bar stays — minus its search and menu — and the screen keeps
 * the name of the thing and the way back out. A form has no header of its own,
 * and an immersive page without one is a screen with no way off it.
 *
 * **The action bar is `sticky`, not `fixed`.** The form's old comment argued
 * against a bottom bar because it "has to dodge the desktop sidebar and the
 * phone's safe area", and both problems are real — but they are problems with
 * `position: fixed`, which is measured against the viewport and therefore has
 * to be told about a sidebar it cannot see. Sticky is measured against this
 * column, which the shell has already inset past the sidebar. It pins to the
 * bottom of the screen while there is form below it and settles at the end of
 * the content when there isn't, which is what a pinned bar is for. The safe
 * area is a padding, below.
 *
 * **Everything else lives in the ⋯.** Preview, Duplicate, Delete — the actions
 * you use once — go in the overflow, as a full-width sheet (ActionSheet), never
 * a 56px menu hanging off a corner. Karl: "preview should be in the 3 dots".
 *
 * LAYOUT CONTRACT: render inside the page's standard `p-4 md:p-8` wrapper. The
 * action bar bleeds to the screen edge on a phone with `-mx-4`, which is what
 * that assumes.
 */
export interface EditScreenAction {
  label: string
  /** What it does. Give this OR href, not both. */
  onClick?: () => void
  /**
   * Where it goes, when the action is a navigation rather than a submit.
   *
   * A READ screen — an offering, seen rather than edited — has "Edit" as its
   * primary action and no Cancel at all; the way out is the back arrow. That
   * was the second use of this component and it fitted without argument, which
   * is the test a shared layout has to pass.
   */
  href?: string
  /** Sits beside the label. Karl asked for icons on these two specifically. */
  icon?: ReactNode
  loading?: boolean
  disabled?: boolean
}

export function EditScreen({
  tabs,
  menu,
  menuTitle,
  primary,
  secondary,
  children,
  className,
}: {
  /** The tab strip, if this screen has one. OfferingTabs is the house strip. */
  tabs?: ReactNode
  /** The ⋯ menu's contents. Omit it and no ⋯ appears. */
  menu?: SheetAction[]
  /** What the sheet calls itself — the name of the thing being edited. */
  menuTitle?: string
  /** Save. Stays the filled brand button at every width. */
  /**
   * Optional: a tab can legitimately have nothing to do. The automation
   * timeline is the case — its steps each carry their own controls, and the
   * only screen-level action left was "Edit", which offered to edit the
   * PACKAGE while you were building its flow (Karl: "automation tab should
   * not have an edit button"). The bar still draws for the ⋯ if there is one.
   */
  primary?: EditScreenAction
  /** Cancel. A bordered white button — a bare glyph next to a filled Save
   *  reads as disabled, which is the one thing a way out must not do. */
  secondary?: EditScreenAction
  children: ReactNode
  className?: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    // The min-height is what makes "pinned" true on a SHORT screen. Sticky
    // pins the bar to the bottom of the viewport while there is content below
    // it and settles it at the end of the content when there isn't — so a tab
    // holding one sentence (the package builder's Automation, before the
    // package exists) left the bar floating two-thirds of the way down with
    // nothing under it. A screenful of container, and the bar has a bottom to
    // sit on either way. Deliberately a little SHORT of the viewport — 5.5rem
    // is the phone header plus the page's own padding — because overshooting
    // buys a scrollbar for empty space.
    <div className={cn('flex flex-col gap-6 min-h-[calc(100dvh-5.5rem)] md:min-h-[calc(100dvh-7.5rem)]', className)}>
      <SetPageImmersive value keepTopBar />
      {/* The shell reserves room at the foot of every phone screen for the five
          bottom tabs. They are gone here, so that reservation is a band of
          nothing under the action bar. Same trick the create circle uses to
          claim its own room, and the two are never on screen together. */}
      <style>{`@media (max-width: 767px) { .pm-main { padding-bottom: 0 !important; } }`}</style>

      {tabs}

      {/* flex-1 so the content takes the slack and the bar keeps the floor.
          Its own gap-6 preserves the spacing children had when they were
          direct descendants. */}
      <div className="flex flex-1 flex-col gap-6">{children}</div>

      {/* Pinned actions. `mt-auto` is deliberately absent: this sits after the
          last field, and sticky does the pinning.

          Not drawn at all when there is nothing to put in it. `primary` became
          optional so a tab could have no action (the automation timeline), and
          an empty bordered bar across the foot of the screen reads as the
          bottom nav coming back — which is exactly what Karl reported. */}
      {(primary || secondary || (menu && menu.length > 0)) && (
      <div
        className="sticky bottom-0 z-30 -mx-4 flex items-center gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:mx-0 md:justify-end"
        // The home indicator on an iPhone sits over the bottom 34px of the
        // screen. Without this the Save button is under it.
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {menu && menu.length > 0 && (
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={menuTitle ? `More actions for ${menuTitle}` : 'More actions'}
            aria-haspopup="dialog"
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          >
            <MoreHorizontal className="h-5 w-5" strokeWidth={1.75} />
          </button>
        )}
        {/* Save takes the width that is left; Cancel takes only what its word
            needs. Splitting the row evenly gave "Save changes" 131px and it
            wrapped onto two lines, and an even split says the two are equally
            likely — they are not. Both stay 44px tall and labelled. From md: up
            the row right-aligns and both go back to their natural width. */}
        {secondary && (
          secondary.href ? (
            <Link
              href={secondary.href}
              aria-label={secondary.label}
              className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 md:px-5"
            >
              {secondary.icon}
              {secondary.label}
            </Link>
          ) : (
            <Button
              variant="secondary"
              onClick={secondary.onClick}
              disabled={secondary.disabled}
              aria-label={secondary.label}
              className="h-11 whitespace-nowrap px-4 md:px-5"
            >
              {secondary.icon}
              {secondary.label}
            </Button>
          )
        )}
        {!primary ? null : primary.href ? (
          // A real <a>, not a button that pushes: it is a navigation, so it
          // middle-clicks, opens in a new tab and shows its target in the
          // status bar like every other link on the page.
          <Link
            href={primary.href}
            aria-label={primary.label}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[var(--pm-brand-600)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--pm-brand-700)] md:flex-none md:px-5"
          >
            {primary.icon}
            {primary.label}
          </Link>
        ) : (
          <Button
            onClick={primary.onClick}
            loading={primary.loading}
            disabled={primary.disabled}
            aria-label={primary.label}
            className="h-11 flex-1 whitespace-nowrap px-4 md:flex-none md:px-5"
          >
            {/* The spinner takes the icon's place while it saves, rather than
                standing beside a second glyph. */}
            {!primary.loading && primary.icon}
            {primary.label}
          </Button>
        )}
      </div>
      )}

      {/* Picking anything closes the sheet — including Delete, which opens a
          confirm of its own and would otherwise open it BEHIND this one. Done
          here so no caller has to remember it. */}
      {menuOpen && menu && (
        <ActionSheet
          title={menuTitle ?? 'More actions'}
          actions={menu.map(a => ({ ...a, onSelect: () => { setMenuOpen(false); a.onSelect() } }))}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  )
}
