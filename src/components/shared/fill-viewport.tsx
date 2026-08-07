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
      // "The viewport" ends at the body's CONTENT edge, not at innerHeight.
      // On a notched phone `html[data-native] body` carries
      // padding-bottom: env(safe-area-inset-bottom) (globals.css) to keep the
      // app clear of the home indicator, while innerHeight still reports the
      // whole webview including that strip. Sizing to innerHeight runs the
      // pane past the body's content box, and what lands under the composer is
      // the reserved strip — read on the phone as a gap. 0 on the web, so
      // every desktop measurement is unchanged.
      const inset = parseFloat(getComputedStyle(document.body).paddingBottom) || 0
      const h = `${Math.round(Math.max(0, window.innerHeight - top - inset))}px`
      // Only write when it actually changes. The MutationObserver below is
      // watching this very element's style attribute, and a same-value write
      // still records a mutation — which would schedule another frame, which
      // would write again, forever.
      if (el.style.height === h) return
      el.style.height = h
    }

    apply()
    // The chrome above can change height without the window changing at all —
    // a wrapping toolbar, a banner appearing — so watch the document, not just
    // the window.
    const ro = new ResizeObserver(apply)
    ro.observe(document.documentElement)

    // …and it can also be REMOVED, which no resize reports. An open message
    // thread declares itself immersive in an effect, and the shell unmounts
    // its phone top bar in response — a tick AFTER this measured. The page's
    // own height never changes (the shell is min-h-screen), so the
    // ResizeObserver above stays silent and the pane keeps a height that is
    // short by the bar it no longer has to clear: 57px of dead white above the
    // composer, on a phone, every time. Watching the DOM catches the element
    // moving up, which is the thing that actually invalidates the reading.
    // Coalesced to a frame so a chatty subtree can't measure per mutation.
    let queued = 0
    const remeasure = () => {
      if (queued) return
      queued = requestAnimationFrame(() => {
        queued = 0
        apply()
      })
    }
    const mo = new MutationObserver(remeasure)
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] })

    // A resize needs measuring more than once. Crossing `md:` swaps the chrome
    // above — the desktop top bar appears and <main> gains its 3.5rem reserve —
    // and both the resize event itself and the frame after it can still read
    // the OLD arrangement while innerHeight already reports the new one. That
    // stale number then sticks forever: a settled layout produces no mutation
    // and no document resize, so nothing comes along to correct it. Seen in
    // both directions (390 → 1280 overflowed by the top bar; 1280 → 390 left a
    // 56px band under the composer). So re-read across a couple of frames and
    // once more after the dust settles. Bounded, and each pass is a no-op when
    // the number hasn't moved.
    const timers: ReturnType<typeof setTimeout>[] = []
    const onResize = () => {
      apply()
      remeasure()
      timers.push(setTimeout(apply, 60), setTimeout(apply, 250))
    }
    window.addEventListener('resize', onResize)
    // Mobile browsers change innerHeight as the URL bar hides; visualViewport
    // reports that where it exists.
    window.visualViewport?.addEventListener('resize', onResize)

    return () => {
      ro.disconnect()
      mo.disconnect()
      if (queued) cancelAnimationFrame(queued)
      timers.forEach(clearTimeout)
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
      el.style.height = ''
    }
  }, [])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
