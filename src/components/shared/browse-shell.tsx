'use client'

import { useCallback, useSyncExternalStore, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

const DESKTOP = '(min-width: 768px)'

function subscribe(cb: () => void) {
  const mq = window.matchMedia(DESKTOP)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/**
 * Is there room for the rail?
 *
 * Read in JS rather than left to a `hidden md:block` class, because the two
 * places the rail can go must never BOTH be mounted: the rail is a dnd-kit
 * sortable list, and a second copy of it — even one that is `display: none` —
 * registers the same draggable ids twice and the drag stops working. Only one
 * of the two is ever rendered.
 *
 * The server answers "desktop", which is what the markup used to be, so a wide
 * screen is right on the first paint; a phone corrects itself on hydration,
 * where the rail was invisible anyway.
 */
function useIsDesktop(): boolean {
  const snapshot = useCallback(() => window.matchMedia(DESKTOP).matches, [])
  return useSyncExternalStore(subscribe, snapshot, () => true)
}

/**
 * The two-column browse frame: a nav rail on the left, what you opened on the
 * right. The Library and the shop both use it, so they behave identically and
 * only differ in what they are listing.
 *
 * Responsive behaviour lives HERE rather than inside whatever is passed in
 * (AGENTS.md: let the container be responsive, keep the component fixed):
 *
 *   • ≥ md — a sticky left column beside the detail pane. The column has no
 *     overflow of its own, so it grows with its content and only the PAGE
 *     scrolls. Never two scrollbars.
 *   • < md — the rail moves to a PAGE of its own, reached by a full-width
 *     button. It used to be dropped altogether, which on a phone left the
 *     categories with nowhere to live: you could not see them, filter by them,
 *     add one, or put them in order. A page rather than a sheet (Karl,
 *     2026-08-02) — it gets the whole screen, the back arrow behaves, and a
 *     long list of categories scrolls the page instead of a panel.
 */
export function BrowseShell({
  nav,
  navLabel = 'Browse',
  navHref,
  children,
}: {
  nav: ReactNode
  /** What the phone's open-the-rail button says — usually where you are now. */
  navLabel?: string
  /** The page that IS the rail on a phone. No link, no button. */
  navHref?: string
  children: ReactNode
}) {
  const isDesktop = useIsDesktop()
  // No button to where you already are — on the Library index the rail's page
  // IS this page.
  const pathname = usePathname()
  const showNavLink = !!navHref && navHref !== pathname

  return (
    <div className="w-full p-4 md:p-8">
      {!isDesktop && showNavLink && navHref && (
        <Link
          href={navHref}
          className="mb-4 flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900"
        >
          <span className="truncate">{navLabel}</span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={2} />
        </Link>
      )}

      <div className="md:grid md:grid-cols-[17rem_minmax(0,1fr)] md:items-start md:gap-8">
        {isDesktop && <aside className="self-start md:sticky md:top-4">{nav}</aside>}
        {/* A query container, so what is INSIDE this column can size itself
            against the column rather than against the window. The rail costs
            it 17rem, so a `lg:` window is nowhere near an `lg:` worth of room
            in here — the products table laid out on viewport breakpoints
            overflowed its own box at 1100px, with the columns landing on top
            of one another. */}
        <div className="min-w-0 @container">{children}</div>
      </div>
    </div>
  )
}
