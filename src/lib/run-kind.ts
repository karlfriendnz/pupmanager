// What KIND of thing a ClassRun is, and where its screens live.
//
// A ClassRun is the single model behind four sections of the app — group
// classes, casual/drop-in classes, one-off events and doggy daycare — and each
// section has its own detail and session screens. Nothing on the RUN says which
// it is; the backing Package does, on three declared flags (isPuppySchool,
// isEvent, allowDropIn). Reading those lives here, once, because every caller
// that worked it out locally eventually got it wrong.
//
// The flags are declared deliberately. "Event" used to be a SHAPE — one
// session, no recurrence, group, not drop-in — and an ordinary class that runs
// once matched it, so it disappeared off the trainer's Classes list and turned
// up under Events instead. Nothing here may go back to inferring a kind.
//
// Deliberately pure and dependency-free: `/sessions/[id]` (a server component)
// and the schedule grid (a client component) both route with it, so it can't
// pull in prisma the way class-runs.ts does.

/**
 * The backing-package filter for a one-off EVENT.
 *
 * An event is a ClassRun like any other — same cohort, roster, capacity and
 * invoicing machinery, just a single occasion — so what makes it an "event"
 * rather than a "class" is one declared flag on its package.
 *
 * It used to be a SHAPE: isGroup && !allowDropIn && sessionCount === 1 && no
 * recurrenceRule. That shape isn't unique to an event. A group class that runs
 * once (the class form's "Doesn't repeat (one-off)" writes exactly
 * sessionCount 1) matched it, so it was excluded from /classes and listed under
 * /events — one live customer lost 55 of her 63 classes off the screen she
 * created them on, and re-saving one in the offering editor re-derived the same
 * wrong answer and made it permanent. The kind is now declared once, at
 * creation, and read back verbatim.
 *
 * Shared because two pages must agree on it exactly: /events selects it and
 * /classes excludes it. If they ever drift, runs get listed twice or vanish.
 */
export const EVENT_PACKAGE = { isEvent: true } as const

/** The same thing said the other way, for the lists that must EXCLUDE events. */
export const NON_EVENT_PACKAGE = { isEvent: false } as const

/**
 * Is this offering a one-off EVENT? Asked of a package you already have in
 * hand — used by the event detail route (which must 404 a class) and by the
 * legacy /classes/[runId] → /events/[id] redirect. One predicate so "what
 * counts as an event" is stated once, and it only ever reads the declared flag.
 */
export function isEventPackage(pkg: { isEvent: boolean }): boolean {
  return pkg.isEvent
}

/** Everything needed to tell the four kinds apart. Select exactly this. */
export type RunKindPackage = {
  isEvent: boolean
  allowDropIn: boolean
  isPuppySchool: boolean
}

export type RunKind = 'daycare' | 'event' | 'casual' | 'class'

/**
 * Which section a run belongs to.
 *
 * Order matters. Daycare is checked first because a puppy-school package could
 * otherwise be flagged as an event and be routed to the wrong screen; the event
 * flag is checked before drop-in so an event is never read as a casual class.
 */
export function runKind(pkg: RunKindPackage): RunKind {
  if (pkg.isPuppySchool) return 'daycare'
  if (isEventPackage(pkg)) return 'event'
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
