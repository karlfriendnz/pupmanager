'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A block that ends exactly at the bottom of the viewport, whatever is above it.
 *
 * Two modes, because a phone and a desktop window need different things.
 *
 * MEASURED (default) — reads its own top edge and takes the rest of the
 * viewport. Screens like the messages pane need a DEFINITE height, or their
 * inner `flex-1 min-h-0 overflow-y-auto` region has nothing to divide and the
 * whole PAGE scrolls instead, taking the pinned header and composer with it.
 * The usual fix is `h-[calc(100dvh-69px)]`, and that 69 is a guess about the
 * chrome above. It was wrong every time it was written: 69px for a PageHeader
 * that renders nothing on a phone, 5rem for a 58px tab bar, and then a window
 * size where the constant simply didn't match. So it measures instead.
 *
 * PINNED (`pin`, phone only) — `position: fixed` against the VISUAL viewport,
 * with body scroll locked. Measuring is not enough on a real phone, and Karl's
 * screen recordings show why:
 *   • the page could still scroll by the home-indicator reserve, so a drag
 *     moved the whole window — header, composer and all;
 *   • focusing the input made iOS scroll it into view, which threw the entire
 *     thread off the top of the screen and left the composer stranded above
 *     the keyboard.
 * Both are the same fault: a scrollable page under a screen that should not
 * scroll. Fixed positioning removes the possibility rather than compensating
 * for it, and visualViewport is what reports the space the keyboard leaves.
 *
 * The element must not itself be inside a scrolled container for the measured
 * reading to be meaningful — which is the point: once it is sized correctly,
 * nothing above it scrolls.
 */
export function FillViewport({
  pin = false,
  className,
  children,
}: {
  /** Pin to the visual viewport on phones (an open message thread). */
  pin?: boolean
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Matches Tailwind's `md:` breakpoint — above it the pane sits in a
    // two-column layout with the list beside it and nothing is pinned.
    const phone = window.matchMedia('(max-width: 767.98px)')

    let restoreOverflow: string | null = null
    const lockScroll = () => {
      if (restoreOverflow !== null) return
      restoreOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    const unlockScroll = () => {
      if (restoreOverflow === null) return
      document.body.style.overflow = restoreOverflow
      restoreOverflow = null
    }

    // Every write is compared against the last one first. The MutationObserver
    // below watches this element's own style attribute, and a same-value write
    // still records a mutation — which would schedule another frame, which
    // would write again, forever.
    let last = ''
    // Baseline for keyboard-by-resize detection, per orientation.
    let baseWidth = window.innerWidth
    let baseHeight = 0
    const apply = () => {
      if (pin && phone.matches) {
        const vv = window.visualViewport
        // offsetTop is how far the visual viewport has been pushed down the
        // layout viewport; honouring it keeps the pane aligned with what the
        // user can actually see if iOS shifts things anyway.
        const top = Math.round(vv?.offsetTop ?? 0)
        const height = Math.round(vv?.height ?? window.innerHeight)
        // Is the keyboard up? It matters because the keyboard COVERS the home
        // indicator while iOS goes on reporting env(safe-area-inset-bottom) as
        // if it didn't — so the composer's reserve for the indicator becomes a
        // strip of nothing between the input and the keys.
        //
        // Detected TWO ways, because the platforms disagree about what the
        // keyboard even does, and this app runs on both:
        //   • Mobile Safari leaves the layout viewport alone and shrinks the
        //     VISUAL one. Karl: "in the browser it works fine."
        //   • The Capacitor webview resizes ITSELF, so innerHeight shrinks and
        //     visualViewport matches it — the first check reads zero and the
        //     reserve never drops. Karl: "in the app its crap."
        // Taking the larger of the two covers both without having to know
        // which shell we're in.
        const shrink = Math.max(0, Math.round(window.innerHeight - height - top))
        // The tallest this viewport has been THIS orientation is its
        // no-keyboard height; anything materially shorter is the keyboard.
        // Re-baselined on rotation, where a real height change is expected.
        if (window.innerWidth !== baseWidth) {
          baseWidth = window.innerWidth
          baseHeight = 0
        }
        baseHeight = Math.max(baseHeight, window.innerHeight)
        // 120px, so a URL bar hiding or a toolbar reflowing can't read as a
        // keyboard — no keyboard is anywhere near that short.
        const resized = baseHeight - window.innerHeight > 120 ? baseHeight - window.innerHeight : 0
        const keyboard = Math.max(shrink, resized)
        const sig = `pin:${top}:${height}:${keyboard}`
        if (sig === last) return
        last = sig
        el.dataset.pinned = 'true'
        if (keyboard > 0) el.dataset.keyboard = 'true'
        else delete el.dataset.keyboard
        el.style.position = 'fixed'
        el.style.left = '0'
        el.style.right = '0'
        el.style.top = `${top}px`
        el.style.height = `${height}px`
        el.style.zIndex = '30'
        lockScroll()
        return
      }

      const top = el.getBoundingClientRect().top + window.scrollY
      // "The viewport" ends at the body's CONTENT edge, not at innerHeight. On
      // a notched phone `html[data-native] body` carries
      // padding-bottom: env(safe-area-inset-bottom) (globals.css) to keep the
      // app clear of the home indicator, while innerHeight still reports the
      // whole webview including that strip. 0 on the web.
      const inset = parseFloat(getComputedStyle(document.body).paddingBottom) || 0
      const height = Math.round(Math.max(0, window.innerHeight - top - inset))
      const sig = `flow:${height}`
      if (sig === last) return
      last = sig
      unlockScroll()
      delete el.dataset.pinned
      delete el.dataset.keyboard
      el.style.position = ''
      el.style.left = ''
      el.style.right = ''
      el.style.top = ''
      el.style.zIndex = ''
      el.style.height = `${height}px`
    }

    apply()

    // The chrome above can change height without the window changing at all —
    // a wrapping toolbar, a banner appearing — so watch the document, not just
    // the window.
    const ro = new ResizeObserver(apply)
    ro.observe(document.documentElement)

    // …and it can also be REMOVED, which no resize reports. An open thread
    // declares itself immersive in an effect, and the shell unmounts its phone
    // top bar in response — a tick AFTER this first measured. The page's own
    // height never changes (the shell is min-h-screen), so the ResizeObserver
    // stays silent and the pane keeps a height short by the bar it no longer
    // has to clear. Coalesced to a frame so a chatty subtree can't measure per
    // mutation.
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
    // above, and both the resize event and the frame after it can still read
    // the OLD arrangement while innerHeight already reports the new one. That
    // stale number then sticks, because a settled layout produces no further
    // mutation or document resize. Seen both ways across the breakpoint.
    const timers: ReturnType<typeof setTimeout>[] = []
    const onResize = () => {
      apply()
      remeasure()
      timers.push(setTimeout(apply, 60), setTimeout(apply, 250))
    }
    window.addEventListener('resize', onResize)
    // The keyboard doesn't change innerHeight on iOS — only the visual
    // viewport reports it, on both resize AND scroll.
    window.visualViewport?.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('scroll', remeasure)
    phone.addEventListener('change', onResize)

    return () => {
      ro.disconnect()
      mo.disconnect()
      if (queued) cancelAnimationFrame(queued)
      timers.forEach(clearTimeout)
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('scroll', remeasure)
      phone.removeEventListener('change', onResize)
      unlockScroll()
      delete el.dataset.pinned
      delete el.dataset.keyboard
      el.style.height = ''
      el.style.position = ''
      el.style.left = ''
      el.style.right = ''
      el.style.top = ''
      el.style.zIndex = ''
    }
  }, [pin])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
