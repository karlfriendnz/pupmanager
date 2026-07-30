import { Resend } from 'resend'
import { env } from './env'
import { isPlaceholderEmail, reachableRecipients } from './no-email'
import { isTrainerMailStopped } from './trainer-mail'

let _client: Resend | null = null
function client(): Resend {
  if (!_client) _client = new Resend(env.RESEND_API_KEY)
  return _client
}

export const PLATFORM_FROM = env.RESEND_FROM_EMAIL

type SendArgs = {
  /** One address, or several for an internal alert that goes to the team. */
  to: string | string[]
  subject: string
  html: string
  // Plain-text fallback. Recommended for deliverability.
  text?: string
  // Override the From address. Defaults to RESEND_FROM_EMAIL. Use
  // `fromTrainer({ name, email })` to build a from-spoof header that
  // looks like the trainer but stays on our verified sender domain.
  from?: string
  replyTo?: string | string[]
  // File attachments (e.g. a generated PDF). `content` is the raw bytes
  // (Buffer) or a base64 string — Resend accepts both.
  attachments?: { filename: string; content: Buffer | string }[]
  /**
   * Send even to a trainer we've otherwise stopped mailing (cancelled, lapsed
   * trial, closed account). For mail a person is entitled to whatever their
   * billing state: verification codes, password resets, a team invite, money
   * that needs their attention, and the win-back mail asking them back.
   * Everything else — drips, nudges, summaries, reminders, announcements — is
   * held. See `trainerMailStopped` in lib/access.
   */
  alwaysSend?: boolean
}

/**
 * The single gate every PupManager email passes through. Beyond handing the
 * message to Resend it enforces two rules:
 *
 * 1. A client with no email address is never mailed. They carry a synthetic
 *    address on a domain with no MX record (see lib/no-email), so anything
 *    sent there is a guaranteed hard bounce, and hard bounces are what cost a
 *    sending domain its reputation. Enforced HERE rather than at each call
 *    site because the call sites are where it was missed: four of them checked
 *    and every transactional path — reminders, invoices, booking automations,
 *    form auto-replies — did not.
 *
 * 2. A trainer who cancelled (or whose trial lapsed, or whose account was
 *    closed) stops hearing from us unless the caller marks the message
 *    `alwaysSend`.
 *
 * Both return the same `{ data, error }` shape with no error, so a caller that
 * only checks for failures treats a suppressed message as a clean send. That
 * is deliberate: not mailing someone who cannot receive mail is the correct
 * outcome, not a failure to report upwards.
 */
export async function sendEmail({ to, subject, html, text, from, replyTo, attachments, alwaysSend }: SendArgs) {
  // Placeholder recipients come out first — before the trainer-stopped lookup,
  // which hits the database and has nothing to say about an address nobody
  // reads. `alwaysSend` does NOT override this: a password reset to a
  // non-existent domain is still a bounce, and there is no message important
  // enough to be worth sending somewhere it cannot arrive.
  const recipients = reachableRecipients(to)
  if (recipients.length === 0) {
    return { data: null, error: null }
  }
  // Keep the caller's original shape. isTrainerMailStopped reads an ARRAY as
  // "internal alert to the team" and exempts it — so handing it a one-element
  // array would quietly switch off the cancelled-trainer suppression for every
  // ordinary send.
  const filtered: string | string[] = Array.isArray(to) ? recipients : recipients[0]

  if (!alwaysSend && await isTrainerMailStopped(filtered)) {
    return { data: null, error: null }
  }

  return client().emails.send({
    from: from ?? PLATFORM_FROM,
    to: filtered,
    subject,
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
    ...(attachments?.length ? { attachments } : {}),
  })
}

// Build a "Trainer Name via PupManager <noreply@pupmanager.com>" From header.
// Using the trainer's actual address as From would fail SPF/DKIM/DMARC because
// Resend isn't authorised to send for arbitrary domains — we keep our verified
// sender and route replies via Reply-To instead.
export function fromTrainer(displayName: string): string {
  const safe = displayName.replace(/["<>]/g, '').trim() || 'PupManager'
  return `${safe} via PupManager <${PLATFORM_FROM}>`
}

// Build a From header for a trainer's BULK send off their OWN verified sending
// subdomain (e.g. "Paws & Thrive <hello@mail.pawsandthrive.com>"). Because the
// trainer has verified that domain in Resend, SPF/DKIM/DMARC pass and the mail
// genuinely comes from them. Callers must only use this once the trainer's
// `domainVerifiedAt` is set — the bulk route hard-blocks otherwise.
export function fromTrainerDomain(displayName: string, sendingFromEmail: string): string {
  const safe = displayName.replace(/["<>]/g, '').trim() || 'PupManager'
  return `${safe} <${sendingFromEmail}>`
}

// Send a batch of distinct emails in one Resend API call (up to 100). Each entry
// is a full message — used by the bulk broadcast where every recipient gets a
// differently-substituted body and unsubscribe link. Returns Resend's result so
// callers can map the per-message ids back to recipients.
export async function sendEmailBatch(
  messages: { to: string; subject: string; html: string; text?: string; from: string; replyTo?: string }[],
) {
  // Placeholder addresses are REFUSED here rather than filtered, unlike
  // sendEmail. Callers map Resend's per-message ids back to recipients by
  // position (`res.data.data[i]` → `group[i]`), so dropping an entry would
  // silently attribute every id after it to the wrong person — a worse bug
  // than the bounce it avoided. Both existing callers already filter upstream,
  // so reaching this is a caller error and should say so.
  const placeholders = messages.filter(m => isPlaceholderEmail(m.to))
  if (placeholders.length) {
    throw new Error(
      `sendEmailBatch: ${placeholders.length} recipient(s) have no real email address ` +
      `(${placeholders.slice(0, 3).map(m => m.to).join(', ')}${placeholders.length > 3 ? ', …' : ''}). ` +
      'Filter them out before batching — see lib/no-email.',
    )
  }
  if (messages.length === 0) {
    return { data: null, error: null }
  }

  return client().batch.send(
    messages.map(m => ({
      from: m.from,
      to: m.to,
      subject: m.subject,
      html: m.html,
      ...(m.text ? { text: m.text } : {}),
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    })),
  )
}

// Expose the Resend client for the few callers that need the domains API
// (sending-domain create/verify). Keeps the single-instance lazy init.
export function resendClient(): Resend {
  return client()
}
