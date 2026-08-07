'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A block that ends exactly at the bottom of the viewport, whatever is above it.
 *
 * Why this exists: screens like the messages pane need a DEFINITE height, or
 * their inner `flex-1 min-h-0 overflow-y-auto` region has nothing to divide and
 * the whole PAGE scrolls instead — taking the pinned header and composer with
 * it. The usual fix is `h-[calc(100dvh-69px)]`, and that 69 is a guess about how
 * tall the chrome above happens to be. It has now been wrong twice here: once by
 * 34px (a tab bar measured as 5rem that is really 58px, and a PageHeader that
 * renders nothing on a phone), and once on a window size where the constant
 * simply didn't match, which is what made the thread scroll.
 *
 * A constant cannot be right across a top bar that appears at md:, a safe-area
 * inset that only exists on a notched device, and a header that renders on some
 * routes and not others. So this measures its own top edge instead and takes the
 * rest of the viewport — no arithmetic to get wrong, and it re-measures whenever
 * the window or the chrome above it changes size.
 *
 * The element must not itself be inside a scrolled container for the reading to
 * be meaningful — which is the point: once it is sized correctly, nothing above
 * it scrolls.
 */
export function FillViewport({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const apply = () => {
      // Viewport-relative top. Read with the page at rest: if anything HAS
      // scrolled we add it back, so a mid-scroll resize can't shrink the pane.
      const top = el.getBoundingClientRect().top + window.scrollY
      const h = Math.max(0, window.innerHeight - top)
      el.style.height = `${Math.round(h)}px`
    }

    apply()
    // The chrome above can change height without the window changing at all —
    // a wrapping toolbar, a banner appearing — so watch the document, not just
    // the window.
    const ro = new ResizeObserver(apply)
    ro.observe(document.documentElement)
    window.addEventListener('resize', apply)
    // Mobile browsers change innerHeight as the URL bar hides; visualViewport
    // reports that where it exists.
    window.visualViewport?.addEventListener('resize', apply)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', apply)
      window.visualViewport?.removeEventListener('resize', apply)
      el.style.height = ''
    }
  }, [])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
