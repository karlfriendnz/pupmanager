/**
 * Teaches the shared capture what PupManager's markup looks like.
 *
 * Imported for its side effect by the widget, once, before anything captures. The
 * app's selectors are tried FIRST; review-core's plain-HTML fallbacks stay
 * underneath, so a screen that follows no convention still captures usefully.
 */
import { configureReviewTarget } from '@/lib/review-core'
import { reactComponentResolver } from '@/lib/review-core/resolvers'

configureReviewTarget({
  // How this app writes a field label (see the mobile-first rules in AGENTS.md).
  labelSelectors: [
    ':scope > .text-sm.font-medium',
    ':scope > .text-xs.font-semibold',
    ':scope > .field-label',
  ],
  // SectionLabel and the flat-list primitives.
  sectionSelectors: [
    ':scope > .section-title',
    ':scope > .text-\\[11px\\].uppercase',
  ],
  // Full-screen sheets are the house pattern, portalled to <body> — they carry
  // role=dialog or the data attribute rather than a framework class.
  dialogSelectors: ['[data-review-dialog]', '[role="dialog"]', '[aria-modal="true"]'],
  resolveComponents: reactComponentResolver,
})

export {}
