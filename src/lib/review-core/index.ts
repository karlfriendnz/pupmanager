// GENERATED — do not edit here.
//
// Copied from the shared review-core package (index.ts, v0.1.1) by
// scripts/sync-review-core.mjs. fm-events reads the same source, so a fix made
// HERE is a fix that only PupManager gets. Change it in review-core:
//   https://github.com/karlfriendnz/review-core
// then re-run `node scripts/sync-review-core.mjs` and commit the result.

/**
 * review-core — the brains of the in-app review widget.
 *
 * Two halves, both framework-agnostic and both shared across projects:
 *
 *  1. THE CAPTURE (`target.ts`) — runs in the browser. Turns the element someone
 *     clicked into a sentence: which field, in which section, in which dialog, on
 *     which view. This is what makes "Padding" actionable a week later.
 *
 *  2. THE BRIEF (`brief.ts`) — runs on the server. Turns approved comments into
 *     markdown an agent works from, including the gate that keeps unapproved
 *     suggestions away from it.
 *
 * What each app still owns, because it cannot be shared:
 *   - the widget UI (Vue in fm-events, React in PupManager)
 *   - storage and routes (MySQL there, Prisma/Postgres here)
 *   - the component resolver, which reads framework internals
 *
 * See README.md for the wiring each app needs.
 */

export {
  describeElement,
  describePoint,
  describeTargetLine,
  elementFromDomPath,
  resolveTargetElement,
  findLabel,
  findSection,
  findScope,
  findDialog,
} from './target'

export {
  configureReviewTarget,
  resetReviewTargetConfig,
  reviewTargetConfig,
  DEFAULT_CONFIG,
} from './config'

export { pageKeyFor, type PageKeyOptions } from './page-key'

export { buildBriefMarkdown, selectForBrief, type BriefOptions } from './brief'

export type {
  ReviewTarget,
  ReviewTargetConfig,
  ComponentResolver,
  BriefComment,
} from './types'
