/**
 * Clients who have no email address.
 *
 * PupManager identifies a person by their email: it is the login, and it is the
 * unique key on User. A client who has never given one still has to exist — a
 * groomer's book is full of people known only by a mobile number — so they are
 * given a synthetic address on a domain that does not resolve:
 *
 *     noemail-<16 hex>@no-email.pupmanager.app
 *
 * Minted in two places, by the same scheme: `src/app/api/clients/route.ts` when
 * a trainer adds a client with the email box empty, and the import toolkit
 * (`scripts/import/loader/parse.ts`) when a client's records never had one.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The rule "we never send to it" was written down in a comment and then
 * enforced by four separate copies of the same string constant, in the four
 * places somebody happened to remember: the two marketing pages, the bulk
 * email route, and the admin announcement sender. Every transactional path —
 * booking reminders, invoices, booking automations, form auto-replies — had no
 * check at all.
 *
 * That gap is not cosmetic. The domain has no MX record, so every message is a
 * hard bounce, and a run of hard bounces is what gets a sending domain
 * throttled or suspended. One salon import added 384 such addresses in a single
 * evening.
 *
 * So the check lives here, once, and is enforced at the gate every message
 * passes through (`sendEmail` in lib/email.ts) rather than at each call site.
 * A caller cannot forget it, and a path written next year is covered by
 * default.
 */

/** The domain synthetic addresses live on. Never deliverable, by design. */
export const NO_EMAIL_DOMAIN = '@no-email.pupmanager.app'

/**
 * True when this address is a stand-in rather than somewhere a person reads
 * mail. Matched on the DOMAIN, not the `noemail-` prefix: the prefix has been
 * generated two different ways (random bytes in the app, a hash of the person
 * in the importer) and a third would go unnoticed, whereas the domain is the
 * part that makes the address undeliverable and is common to all of them.
 */
export function isPlaceholderEmail(address: string | null | undefined): boolean {
  return !!address && address.trim().toLowerCase().endsWith(NO_EMAIL_DOMAIN)
}

/** True when the person has an address somebody could actually read. */
export function isReachableEmail(address: string | null | undefined): boolean {
  return !!address?.trim() && !isPlaceholderEmail(address)
}

/**
 * Drop every placeholder from a recipient list, preserving order.
 * Accepts the `string | string[]` shape the mailer takes.
 */
export function reachableRecipients(to: string | string[]): string[] {
  return (Array.isArray(to) ? to : [to]).filter(isReachableEmail)
}
