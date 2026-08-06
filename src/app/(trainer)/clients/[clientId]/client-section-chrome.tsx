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
      {/* The shell reserves 5rem at the foot of every phone screen for the tab
          bar. It isn't there, so that reservation is a band of nothing. */}
      <style>{`@media (max-width: 767px) { .pm-main { padding-bottom: 0 !important; } }`}</style>
    </>
  )
}
