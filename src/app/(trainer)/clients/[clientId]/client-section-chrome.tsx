'use client'

import { SetPageImmersive } from '@/components/shared/page-title'

/**
 * The chrome every one of a client's section pages wears: the phone's bottom
 * tab bar and the global "+" stand down, the shell's top bar stays (back arrow
 * + the page's title).
 *
 * Identical to the profile's own declaration, on purpose — you are inside one
 * client for the whole journey, and chrome that comes and goes as you move
 * around inside a record is the "jumpy" complaint Karl has already made twice.
 *
 * Deliberately NOT EditScreen: that layout exists for a screen with a pinned
 * Save/Cancel bar, and a section of a record has neither. Reusing it would mean
 * inventing a primary action to satisfy its required `primary` prop.
 */
export function ClientSectionChrome() {
  return (
    <>
      <SetPageImmersive value keepTopBar />
      {/* The shell's foot reserve is 5rem for the tab bar PLUS the
          home-indicator inset. Only the 5rem goes — these section pages have no
          pinned bar to hold that strip themselves, so zeroing both put the last
          row under the home indicator (Karl: "no safe space"). */}
      <style>{`@media (max-width: 767px) { .pm-main { padding-bottom: env(safe-area-inset-bottom, 0px) !important; } }`}</style>
    </>
  )
}
