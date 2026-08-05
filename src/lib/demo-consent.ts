/**
 * The exact words a "Try It" visitor agreed to, and the ids we store against
 * their consent.
 *
 * WHY THIS FILE IS APPEND-ONLY
 * ----------------------------
 * PupManager is NZ-based and sells worldwide, so a consent record has to answer
 * a GDPR / CCPA / Australian-APP question years after the fact: not "did they
 * tick a box" but "what did the box SAY". A boolean cannot answer that, and
 * neither can a version id whose text has since been edited.
 *
 * So: a wording change mints a NEW id and leaves the old block exactly where it
 * is. `DemoLead.termsVersion` / `marketingVersion` hold the id, and
 * `consentText(id)` resolves it forever. Never edit the `text` of a published
 * entry — add `try-terms-v2` beside `try-terms-v1`.
 *
 * COPY STATUS: PLACEHOLDER. Karl approves all user-facing copy; these are
 * plain-English stand-ins written to be legally shaped and easy to read, not
 * approved wording. Replacing them means adding a v2, not editing v1.
 */

export type ConsentBlock = {
  id: string
  /** What the visitor sees beside the tick box. */
  label: string
  /** The full text the tick stands for — this is the record. */
  text: string
  /** Terms are required to proceed; marketing never is. */
  required: boolean
}

/**
 * The one tick box a visitor sees (Karl, 2026-08-06: "there should only be one
 * tick box... the marketing terms should be inside here").
 *
 * It mentions product email, and it deliberately does NOT claim marketing
 * consent: `marketingOptIn` stays false for anyone who agrees to this. Ticking
 * a REQUIRED box cannot be "freely given" consent under GDPR, so recording it
 * as consent would produce a database full of permissions that evaporate the
 * moment one is questioned — and the marketing database is the point of the
 * whole exercise. Product email to a business contact who handed it over at a
 * stand rides on legitimate interest with an unsubscribe in every message.
 *
 * v2 rather than an edit of v1: see the append-only note above.
 */
export const TRY_TERMS_V2: ConsentBlock = {
  id: 'try-terms-v2',
  label: 'I agree to the terms',
  required: true,
  text:
    'This is a demo of PupManager. Everything in it is made-up practice data. ' +
    'Please do not put real client, dog, health or payment details into it. ' +
    'The demo workspace and everything you do in it is deleted when you leave, ' +
    'or automatically a short time later. It cannot send emails or messages to ' +
    'anyone. We keep the name, business name and email you gave us on this ' +
    'form, and we may email you about PupManager — you can stop that at any ' +
    'time using the unsubscribe link in any message. We do not sell or share ' +
    'your details with anyone else. We look after your details under our ' +
    'Privacy Policy, and you can ask us to delete them at any time by emailing ' +
    'hello@pupmanager.com.',
}

/** Superseded by TRY_TERMS_V2. Kept so existing records still resolve. */
export const TRY_TERMS: ConsentBlock = {
  id: 'try-terms-v1',
  label: 'I agree to the demo terms',
  required: true,
  text:
    'This is a demo of PupManager. Everything in it is made-up practice data. ' +
    'Please do not put real client, dog, health or payment details into it. ' +
    'The demo workspace and everything you do in it is deleted when you leave, ' +
    'or automatically a short time later. It cannot send emails or messages to ' +
    'anyone. We keep the name, business name and email you gave us on this ' +
    'form. We look after your details under our Privacy Policy, and you can ask ' +
    'us to delete them at any time by emailing hello@pupmanager.com.',
}

/**
 * The marketing consent. SEPARATE and optional, on purpose: agreeing to the
 * terms is not agreeing to be sold to, and an unticked box must still get a
 * working sandbox.
 */
export const TRY_MARKETING: ConsentBlock = {
  id: 'try-marketing-v1',
  label: 'Email me about PupManager',
  required: false,
  text:
    'Yes, PupManager can email me about the product — new features, tips for ' +
    'running a dog business, offers and prices. This is marketing email, not ' +
    'part of the demo. You can stop it at any time using the unsubscribe link ' +
    'in any message, or by emailing hello@pupmanager.com. We do not sell or ' +
    'share your details with anyone else.',
}

/** Every consent block ever published, old versions included. Append only. */
export const CONSENT_BLOCKS: ConsentBlock[] = [TRY_TERMS_V2, TRY_TERMS, TRY_MARKETING]

/**
 * What the form actually shows today — one box.
 *
 * Separate from CONSENT_BLOCKS on purpose: that list can only ever grow,
 * because it is what `consentText(id)` reads to explain a record written two
 * years ago. This is the current form, and it is allowed to shrink.
 */
export const ACTIVE_CONSENT_BLOCKS: ConsentBlock[] = [TRY_TERMS_V2]

/**
 * What we say when somebody taps "Start my own account" from inside the demo.
 *
 * NOT a consent block — nothing is recorded against it, so it is not versioned
 * and it does not go in CONSENT_BLOCKS. It lives here anyway because this is
 * the file that holds the demo's user-facing words, and Karl approves all of
 * them in one pass rather than hunting through components.
 *
 * COPY STATUS: PLACEHOLDER, same as the blocks above.
 *
 * The one thing this wording must do is say, before they commit, that the
 * practice data does not come with them. Burying that would mean a trainer
 * signs up expecting the week they just built and finds an empty account —
 * which is the moment they decide we are not careful people.
 */
export const TRY_CONVERT_COPY = {
  /** The button in the demo strip, on every screen. */
  action: 'Start my own account',
  /** The confirm screen's title. */
  title: 'Start your own account',
  /**
   * The sentence that must not be buried. One plain line, no hedging, and it
   * says what is lost rather than what is kept.
   */
  warning:
    'This ends the demo and sets up a fresh account. The practice clients, dogs and bookings you have been playing with do not come with you — you start with an empty account and add your own.',
  /** What we WILL carry over, so the promise is specific rather than vague. */
  reassurance: 'We will fill in your name, business name and email so you do not have to type them again.',
  confirm: 'Set up my account',
  cancel: 'Keep looking around',
} as const

/**
 * Resolve a stored version id back to the words that were on screen. Returns
 * null for an id we have never published — which should be impossible, and is
 * therefore worth surfacing rather than papering over with a default.
 */
export function consentText(versionId: string): ConsentBlock | null {
  return CONSENT_BLOCKS.find(b => b.id === versionId) ?? null
}

/**
 * True when `versionId` is the version currently on screen for that block.
 * Used by the API to refuse a submission carrying a stale or invented id —
 * a client that posts `try-terms-v0` did not see the terms we are recording.
 */
export function isCurrentConsentVersion(kind: 'terms' | 'marketing', versionId: string): boolean {
  // "Current" means on screen now, not merely published. TRY_TERMS (v1) still
  // resolves through consentText for records written against it, but a NEW
  // submission carrying it did not read today's words. Marketing is no longer
  // asked for at all, so nothing is current for it.
  if (kind === 'marketing') return false
  return TRY_TERMS_V2.id === versionId
}
