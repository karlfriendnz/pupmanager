// Negotiating a booking time.
//
// A pending BookingRequest used to have two endings — the trainer confirmed the
// client's chosen time, or declined it. Declining is a dead end: the client is
// told no and has to start again, with no idea which hour would have worked.
// This module is the third path. Either side may COUNTER-OFFER a different
// time; the other side approves it or answers with one of their own; it volleys
// until somebody approves, and approving books it.
//
// ─── Three rules, and they all live on the server ────────────────────────────
//
// 1. A proposal is a MESSAGE. It is created as a row in the existing
//    client↔trainer thread and rendered there as a card. The whole negotiation
//    therefore reads as one conversation, in order, in the one place both
//    parties already look — and it inherits the message notifier, the SSE
//    stream, the unread badge and the email fallback rather than needing a
//    second inbox that would have to be kept in step with the first.
//
// 2. Only the NEWEST proposal is live. Making one marks every other OPEN
//    proposal on the request SUPERSEDED in the same transaction, and approval
//    requires OPEN. An older card scrolled up the thread cannot book a time the
//    conversation moved past three messages ago — hiding its button is not what
//    makes that true, `status` is.
//
// 3. Nobody approves their own suggestion. `proposedBy` is compared against the
//    approving party, so an approval is always the other side saying yes.
//
// ─── What a counter-offer means for a multi-session package ──────────────────
//
// `sessionDates` is an array: a 1:1 package generates a CADENCE (sessionCount
// sessions, weeksBetween apart) from one chosen start. A counter-offer moves
// the WHOLE SERIES — it re-derives the array from the proposed first session
// with `generateSessionDates`, the same generator the client's original request
// used.
//
// That is the choice that matches how confirming already works. Confirming
// books the stored array wholesale, and that array was produced by the
// generator; re-deriving keeps a negotiated series structurally identical to a
// straight one — same length, same spacing, same titles by index,
// `startDate = sessionDates[0]`. Moving only session one would leave an
// irregular first gap that no other path in this app can produce, and the
// client never chose the later dates anyway: they chose a start, and everything
// after it was derived. One decision was made, so one decision is countered.
import { generateSessionDates } from './class-runs'
import { overlapsBusy, type BusyInterval } from './availability'
import { utcToZonedDateAndMinutes } from './timezone'

/** Which side of the conversation an actor is on. */
export type ProposalParty = 'TRAINER' | 'CLIENT'

// ─── Copy ────────────────────────────────────────────────────────────────────
//
// PLACEHOLDER COPY — Karl approves all user-facing wording. These are the
// defaults the composer pre-fills; both are editable before sending, and the
// trainer's is the one Karl asked for in the brief.

/** Pre-filled into the composer when the trainer suggests a different time. */
export const TRAINER_PROPOSAL_DEFAULT =
  'That time doesn’t work for me — could we do this instead?'

/** Pre-filled when the CLIENT counters the trainer's suggestion. */
export const CLIENT_PROPOSAL_DEFAULT =
  'That time doesn’t work for me — could we do this instead?'

export function defaultProposalMessage(party: ProposalParty): string {
  return party === 'TRAINER' ? TRAINER_PROPOSAL_DEFAULT : CLIENT_PROPOSAL_DEFAULT
}

/** Posted into the thread when a proposal is approved, so the conversation
 *  itself records the outcome instead of ending on an unanswered question. */
export function acceptedMessage(when: string): string {
  return `That works — booked in for ${when}.`
}

// ─── The series ──────────────────────────────────────────────────────────────

export interface ProposalPackage {
  sessionCount: number
  weeksBetween: number
  durationMins: number
  bufferMins?: number | null
}

/**
 * The full proposed series from a proposed FIRST session. See the header: a
 * counter-offer moves the whole cadence, re-derived with the same generator the
 * original request used, so the result is indistinguishable from a straight
 * request's `sessionDates`.
 */
export function proposalSessionDates(start: Date, pkg: ProposalPackage): Date[] {
  return generateSessionDates(start, pkg.sessionCount, pkg.weeksBetween)
}

/** Stored JSON (`string[]`) → Dates, dropping anything unparseable. Mirrors the
 *  confirm route's own read of `BookingRequest.sessionDates`. */
export function parseSessionDates(raw: unknown): Date[] {
  return (Array.isArray(raw) ? raw : [])
    .map(d => new Date(String(d)))
    .filter(d => !Number.isNaN(d.getTime()))
}

// ─── The collision gate ──────────────────────────────────────────────────────

export interface CollisionArgs {
  /** The trainer's existing UPCOMING sessions, from getTrainerAvailability*. */
  busy: BusyInterval[]
  tz: string
  dates: Date[]
  durationMins: number
  bufferMins?: number | null
}

/**
 * The first proposed session that now runs into something already in the diary,
 * or null when the whole series is clear.
 *
 * Deliberately the SAME predicate the client's self-book route gates on
 * (`overlapsBusy`, gate two of `checkBookableStart`), fed from the same
 * `getTrainerAvailability*` loader — so "that time's just been taken" means the
 * same thing here as it does everywhere else, buffers included.
 *
 * This is re-run at APPROVAL, not only when the time is proposed. The gap
 * between an offer and a yes is exactly where somebody else books the hour, and
 * a negotiation that ends in a double-booking is worse than one that ends in
 * "pick another".
 */
export function firstCollision(args: CollisionArgs): Date | null {
  for (const d of args.dates) {
    const { dateStr, minuteOfDay } = utcToZonedDateAndMinutes(d, args.tz)
    if (overlapsBusy(args.busy, dateStr, minuteOfDay, args.durationMins, args.bufferMins ?? 0)) {
      return d
    }
  }
  return null
}

// ─── Describing one ──────────────────────────────────────────────────────────

/** "Thu 17 Jul, 2:00 PM" in the trainer's timezone — the session happens in
 *  their locale, so a UTC clock must never tip it onto the wrong day. */
export function proposalWhen(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: tz,
  }).format(d)
}

/** The one-line summary that goes in the message body, so the proposal still
 *  reads as a sentence in an email digest or a push preview where the card
 *  itself cannot render. */
export function describeProposal(dates: Date[], tz: string, packageName: string): string {
  if (dates.length === 0) return packageName
  const first = proposalWhen(dates[0], tz)
  if (dates.length === 1) return `${packageName} — ${first}`
  return `${packageName} — starting ${first}, ${dates.length} sessions`
}
