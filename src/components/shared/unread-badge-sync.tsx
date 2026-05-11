'use client'

import { useEffect } from 'react'

// Mirrors the user's total unread count into the browser tab and the
// OS-level Badging API. Mounted inside AppShell so it gets a fresh
// count every time the layout's server query re-runs (which happens
// on navigation, on `router.refresh()` from a push receipt, etc).
//
// Two surfaces are updated:
//   - document.title — gets a "(N) " prefix so a trainer who has
//     PupManager open in one of many tabs sees the count from the
//     tab strip.
//   - navigator.setAppBadge(N) — modern Badging API, supported in
//     Chrome/Edge on macOS/Windows and on installed PWAs. Draws a
//     red number on the Dock / taskbar icon. Silently does nothing
//     in browsers that don't implement it (Safari, Firefox).
export function UnreadBadgeSync({ total }: { total: number }) {
  useEffect(() => {
    const original = document.title
    const stripped = original.replace(/^\(\d+\)\s+/, '')
    if (total > 0) {
      document.title = `(${total}) ${stripped}`
    } else if (original !== stripped) {
      document.title = stripped
    }

    // Badging API — call setAppBadge on positive counts, clearAppBadge
    // (or setAppBadge with no arg) to remove. `as any` because the
    // typings here are still experimental in some lib.dom versions.
    const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    })
    if (nav?.setAppBadge) {
      if (total > 0) nav.setAppBadge(total).catch(() => {})
      else nav.clearAppBadge?.().catch(() => {})
    }

    return () => {
      // On unmount restore the title (without our prefix) so a different
      // mount can rebuild from a clean baseline. Don't clear the badge
      // here — sign-out / app-close handles that path implicitly.
      document.title = document.title.replace(/^\(\d+\)\s+/, '')
    }
  }, [total])

  return null
}
