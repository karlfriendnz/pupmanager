/**
 * The marketing side of "Try It" — capturing the lead, and the small pieces of
 * plumbing the public endpoints share.
 *
 * The lead is the point of the exercise. The sandbox is destroyed within hours;
 * the name, business, email, persona and consent record stay. Nothing in this
 * file is reachable from the purge path.
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { TRY_TERMS, TRY_MARKETING } from '@/lib/demo-consent'
import { DEMO_PERSONA_IDS } from '@/lib/demo-tenant'

/**
 * Which lead the browser is part-way through. httpOnly so a visitor cannot
 * point the persona step at somebody else's lead id, and short-lived because a
 * capture nobody finished is not worth remembering.
 */
export const TRY_LEAD_COOKIE = 'pm-try-lead'
export const TRY_LEAD_COOKIE_MAX_AGE = 60 * 60 * 4

/**
 * Names the lead whose details should PREFILL the real sign-up form, set when
 * somebody taps "Start my own account" from inside the demo.
 *
 * A cookie rather than query parameters, for two reasons that both matter:
 * putting a name, business and email in a URL writes them into browser history
 * and every access log between here and the server; and httpOnly means the
 * form on the other side is filled from a row WE looked up, not from whatever
 * a link happened to say.
 *
 * Deliberately short-lived. This is a stand where phones get handed around, and
 * a prefill cookie that outlived the walk from the poster to the sign-up form
 * would eventually put one visitor's email in front of the next one.
 */
export const TRY_PREFILL_COOKIE = 'pm-try-prefill'
export const TRY_PREFILL_MAX_AGE = 60 * 20

/**
 * Where they came from. Allow-listed rather than stored as typed: `?src=` is on
 * a poster a stranger can photograph and edit, and this column ends up in a
 * marketing export.
 */
export const TRY_SOURCES = ['qr', 'link'] as const
export type TrySource = (typeof TRY_SOURCES)[number]

export function normaliseSource(raw: string | null | undefined): TrySource {
  return TRY_SOURCES.includes(raw as TrySource) ? (raw as TrySource) : 'link'
}

/** Campaign tag from `?ev=`. Squeezed to a short, boring slug for the same reason. */
export function normaliseCampaign(raw: string | null | undefined): string | null {
  if (!raw) return null
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return slug || null
}

/**
 * A salted, one-way fingerprint of the client IP.
 *
 * Enough to see "forty leads from one address" when someone plays with the
 * poster; not an IP log, which is personal data we have no reason to hold on
 * people who have not become customers. Salted with AUTH_SECRET so the hashes
 * are not a rainbow-table away from the addresses.
 */
export function hashIp(ip: string): string | null {
  if (!ip || ip === 'unknown') return null
  const salt = process.env.AUTH_SECRET ?? ''
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32)
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * The capture form, validated on the SERVER.
 *
 * Every rule the screen enforces is repeated here, because a `required`
 * attribute and a `type="email"` are decoration — this codebase has already
 * shipped an intake form that validated in the browser and accepted anything
 * from the API (AGENTS.md #3).
 */
export const tryLeadSchema = z.object({
  name: z.string().trim().min(1, 'Please tell us your name').max(80),
  companyName: z.string().trim().min(1, 'Please tell us your business name').max(80),
  email: z.string().trim().toLowerCase().email('That does not look like an email address').max(160),
  /** Must be literally true. Optional-with-a-default would let an empty body through. */
  acceptTerms: z.literal(true),
  /** Which wording they saw. Checked against the current id below. */
  termsVersion: z.string().max(60),
  marketingOptIn: z.boolean().default(false),
  marketingVersion: z.string().max(60),
  source: z.string().max(20).optional(),
  campaign: z.string().max(60).optional(),
})

export type TryLeadInput = z.infer<typeof tryLeadSchema>

/**
 * Refuse a submission carrying a consent version we are not currently showing.
 * A client posting a stale or invented id did not read the words we would then
 * be recording them as having agreed to, which makes the record worthless — and
 * a worthless consent record is worse than none, because it looks like proof.
 */
export function consentVersionsAreCurrent(input: Pick<TryLeadInput, 'termsVersion' | 'marketingVersion'>): boolean {
  return input.termsVersion === TRY_TERMS.id && input.marketingVersion === TRY_MARKETING.id
}

export const tryLaunchSchema = z.object({
  persona: z.string().refine(p => DEMO_PERSONA_IDS.includes(p), 'Pick one of the options'),
})

// ─── Abuse limits ────────────────────────────────────────────────────────────
//
// The endpoint is a QR code on a poster: anyone who can point a camera can call
// it, and nobody signs in first. Three limits, each answering a different
// question.

/** Leads per IP per hour. A stand shares one wifi, so this has to be generous. */
export const TRY_LEAD_PER_IP = 40
export const TRY_LEAD_WINDOW_MS = 60 * 60_000

/**
 * SANDBOXES per IP per hour. Much tighter than leads: a lead is a row, a
 * sandbox is ~200 rows and a tenant. Someone filling the form five times from
 * one phone is curious; the twentieth is a script.
 */
export const TRY_LAUNCH_PER_IP = 8
export const TRY_LAUNCH_WINDOW_MS = 60 * 60_000

/** One lead does not get to spin up a farm, however many IPs it comes from. */
export const TRY_LAUNCH_PER_LEAD = 3

/**
 * The hard ceiling on live sandboxes, whoever is asking. Karl's requirement is
 * 30 concurrent; this leaves room for the ones that have not been swept yet
 * while still being a number that cannot run away overnight. Over it, the
 * endpoint says "we're busy, try in a minute" rather than making tenant 4,000.
 */
export const TRY_MAX_CONCURRENT_SANDBOXES = 120
