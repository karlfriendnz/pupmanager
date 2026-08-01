import type { ReactNode } from 'react'

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
 *   • < md — no rail at all. The whole width is the screen you opened, and you
 *     move around by drilling in from the index, which is how every other
 *     phone screen in the app behaves.
 */
export function BrowseShell({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <div className="w-full p-4 md:p-8">
      <div className="md:grid md:grid-cols-[17rem_minmax(0,1fr)] md:items-start md:gap-8">
        <aside className="hidden self-start md:sticky md:top-4 md:block">{nav}</aside>
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
