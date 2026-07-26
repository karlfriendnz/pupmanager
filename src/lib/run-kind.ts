// What KIND of thing a ClassRun is, and where its screens live.
//
// A ClassRun is the single model behind four sections of the app — group
// classes, casual/drop-in classes, one-off events and doggy daycare — and each
// section has its own detail and session screens. Nothing on the row says which
// it is: the kind is derived from the backing Package's shape, which is why
// every caller that tried to derive it locally eventually got it wrong. The
// derivation lives here, once.
//
// Deliberately pure and dependency-free: `/sessions/[id]` (a server component)
// and the schedule grid (a client component) both route with it, so it can't
// pull in prisma the way class-runs.ts does.

/**
 * The backing-package shape of a one-off EVENT: a group offering that runs once
 * and doesn't repeat. An event is a ClassRun like any other — same cohort,
 * roster, capacity and invoicing machinery, just a single session — so what
 * makes it an "event" rather than a "class" is only this shape.
 *
 * Shared because two pages must agree on it exactly: /events selects it and
 * /classes excludes it. If they ever drift, runs get listed twice or vanish.
 */
export const ONE_OFF_EVENT_PACKAGE = {
  isGroup: true,
  allowDropIn: false,
  sessionCount: 1,
  recurrenceRule: null,
} as const

/**
 * Is this offering a one-off EVENT? The same shape ONE_OFF_EVENT_PACKAGE
 * selects for, asked of a package you already have in hand — used by the event
 * detail route (which must 404 a class) and by the legacy /classes/[runId]
 * redirect. One predicate so "what counts as an event" is stated once.
 */
export function isOneOffEventPackage(pkg: {
  isGroup: boolean
  allowDropIn: boolean
  sessionCount: number
  recurrenceRule: string | null
}): boolean {
  return (
    pkg.isGroup === ONE_OFF_EVENT_PACKAGE.isGroup &&
    pkg.allowDropIn === ONE_OFF_EVENT_PACKAGE.allowDropIn &&
    pkg.sessionCount === ONE_OFF_EVENT_PACKAGE.sessionCount &&
    !pkg.recurrenceRule
  )
}

/** Everything needed to tell the four kinds apart. Select exactly this. */
export type RunKindPackage = {
  isGroup: boolean
  allowDropIn: boolean
  sessionCount: number
  recurrenceRule: string | null
  isPuppySchool: boolean
}

export type RunKind = 'daycare' | 'event' | 'casual' | 'class'

/**
 * Which section a run belongs to.
 *
 * Order matters. Daycare is checked first because a puppy-school package can
 * otherwise satisfy the event or casual shape; the event shape is checked
 * before drop-in because it pins `allowDropIn: false` and would otherwise fall
 * through to "class".
 */
export function runKind(pkg: RunKindPackage): RunKind {
  if (pkg.isPuppySchool) return 'daycare'
  if (isOneOffEventPackage(pkg)) return 'event'
  if (pkg.allowDropIn) return 'casual'
  return 'class'
}

/** The label a trainer would use for the run's kind. */
export function runKindLabel(pkg: RunKindPackage): string {
  switch (runKind(pkg)) {
    case 'daycare': return 'Daycare'
    case 'event': return 'Event'
    case 'casual': return 'Casual class'
    case 'class': return 'Class'
  }
}

/** The URL prefix of the section this kind lives under. */
export const RUN_KIND_BASE_PATH: Record<RunKind, string> = {
  daycare: '/doggy-daycare',
  event: '/events',
  casual: '/casual-classes',
  class: '/classes',
}

/** The detail screen for this run, in the section it belongs to. */
export function runHref(runId: string, pkg: RunKindPackage): string {
  return `${RUN_KIND_BASE_PATH[runKind(pkg)]}/${runId}`
}

/**
 * The screen for ONE session of a run.
 *
 * An event is the exception and it isn't an oversight: an event has exactly one
 * session by definition, so there is no per-session screen to route to — its
 * run page IS the session, and /events/[eventId] shows the roster directly.
 * Everything else has `<section>/[runId]/sessions/[sessionId]`.
 */
export function runSessionHref(
  runId: string,
  sessionId: string,
  pkg: RunKindPackage,
): string {
  const kind = runKind(pkg)
  if (kind === 'event') return `${RUN_KIND_BASE_PATH.event}/${runId}`
  return `${RUN_KIND_BASE_PATH[kind]}/${runId}/sessions/${sessionId}`
}
