// GENERATED — do not edit here.
//
// Copied from the shared review-core package (config.ts, v0.1.1) by
// scripts/sync-review-core.mjs. fm-events reads the same source, so a fix made
// HERE is a fix that only PupManager gets. Change it in review-core:
//   https://github.com/karlfriendnz/review-core
// then re-run `node scripts/sync-review-core.mjs` and commit the result.

import type { ReviewTargetConfig } from './types'

/**
 * Conventions that work on a page which has never heard of this package.
 *
 * Everything here is standard HTML or an explicit `data-review-*` opt-in. An app
 * with its own idioms (a `.field-label` class, a particular modal shell) passes
 * them to `configureReviewTarget` and they are tried FIRST — see mergeConfig.
 */
export const DEFAULT_CONFIG: ReviewTargetConfig = {
  sectionSelectors: [
    ':scope > [data-review-section]',
    ':scope > h1',
    ':scope > h2',
    ':scope > h3',
    ':scope > div > h2',
    ':scope > div > h3',
    // Last: a <header> is often the whole page's nav, not this element's section.
    // Bounded by MAX_SECTION in target.ts, but ordered last so a real heading wins.
    ':scope > header',
  ],
  labelSelectors: [
    ':scope > label',
    ':scope > [data-review-label]',
  ],
  dialogSelectors: [
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[data-review-dialog]',
  ],
  dialogTitleSelectors: [
    '[data-review-dialog-title]',
    'h1',
    'h2',
  ],
  activeStepSelectors: [
    '[aria-current="step"]',
    '[aria-current="page"]',
    '[aria-selected="true"]',
  ],
  // Tailwind and friends. 'flex items-center gap-2' identifies nothing, so a
  // readable selector has to skip it and keep the semantic class instead.
  utilityClassPattern:
    /^(p|m|px|py|mx|my|mt|mb|ml|mr|w|h|gap|flex|grid|text|bg|border|rounded|shadow|absolute|relative|fixed|sticky|top|left|right|bottom|z|min|max|overflow|items|justify|content|space|divide|hidden|block|inline|truncate|tabular|font|leading|tracking|ring|outline|cursor|transition|hover|focus|group|sm:|md:|lg:|xl:)[-:]?/,
}

let current: ReviewTargetConfig = DEFAULT_CONFIG

/**
 * Teach the capture this app's markup. The app's own selectors go FIRST — they
 * are more specific than the generic fallbacks, and a `.field-label` that the app
 * uses everywhere should beat a stray `<label>` further up the tree.
 *
 * Call it once, at module scope, before any capture happens.
 */
export function configureReviewTarget(partial: Partial<ReviewTargetConfig>): void {
  current = {
    ...DEFAULT_CONFIG,
    ...partial,
    sectionSelectors: [...(partial.sectionSelectors ?? []), ...DEFAULT_CONFIG.sectionSelectors],
    labelSelectors: [...(partial.labelSelectors ?? []), ...DEFAULT_CONFIG.labelSelectors],
    dialogSelectors: [...(partial.dialogSelectors ?? []), ...DEFAULT_CONFIG.dialogSelectors],
    dialogTitleSelectors: [...(partial.dialogTitleSelectors ?? []), ...DEFAULT_CONFIG.dialogTitleSelectors],
    activeStepSelectors: [...(partial.activeStepSelectors ?? []), ...DEFAULT_CONFIG.activeStepSelectors],
  }
}

/** The config in force. Internal — exported for the tests. */
export function reviewTargetConfig(): ReviewTargetConfig {
  return current
}

/** Back to the defaults. For tests, and for an app that wants a clean slate. */
export function resetReviewTargetConfig(): void {
  current = DEFAULT_CONFIG
}
