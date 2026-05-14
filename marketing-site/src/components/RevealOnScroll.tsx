'use client'

import { useEffect } from 'react'

/**
 * Lightweight scroll-reveal. Looks for any element with [data-reveal] and
 * fades + slides it in as it enters the viewport. Optional [data-reveal-delay]
 * (ms) staggers items in a grid.
 *
 * SSR-safe: hidden state is only applied once we add `reveal-ready` to <html>
 * on hydrate, so users with JS disabled (or before hydration) see content
 * immediately. Respects prefers-reduced-motion.
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement
            const delay = el.dataset.revealDelay
            if (delay) el.style.transitionDelay = `${delay}ms`
            el.dataset.revealed = 'true'
            io.unobserve(el)
          }
        }
      },
      // Fire as soon as the element starts entering the viewport so the fade
      // begins right when the user is about to look at it, not after.
      { threshold: 0, rootMargin: '0px 0px -60px 0px' },
    )

    const tracked = new WeakSet<Element>()

    function track(el: HTMLElement) {
      if (tracked.has(el) || el.dataset.revealed === 'true') return
      tracked.add(el)
      // Synchronously reveal anything already in or above the viewport.
      // Without this, there's a window between adding `.reveal-ready` and the
      // IO callback firing where above-the-fold content is blank — and items
      // landing in the bottom-60px dead zone never fire until the user scrolls.
      const vh = window.innerHeight || document.documentElement.clientHeight
      if (el.getBoundingClientRect().top < vh - 60) {
        el.dataset.revealed = 'true'
        return
      }
      io.observe(el)
    }

    document.querySelectorAll<HTMLElement>('[data-reveal]').forEach(track)
    document.documentElement.classList.add('reveal-ready')

    // Catch reveal elements added by App Router navigations — RevealOnScroll
    // sits in the root layout and only runs once, so without this, every page
    // after the first would render blank until reload.
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return
          if (node.matches('[data-reveal]')) track(node)
          node.querySelectorAll<HTMLElement>('[data-reveal]').forEach(track)
        })
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })

    return () => {
      mo.disconnect()
      io.disconnect()
    }
  }, [])

  return null
}
