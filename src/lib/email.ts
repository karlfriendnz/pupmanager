import { Resend } from 'resend'
import { env } from './env'

let _client: Resend | null = null
function client(): Resend {
  if (!_client) _client = new Resend(env.RESEND_API_KEY)
  return _client
}

const PLATFORM_FROM = env.RESEND_FROM_EMAIL

type SendArgs = {
  to: string
  subject: string
  html: string
  // Plain-text fallback. Recommended for deliverability.
  text?: string
  // Override the From address. Defaults to RESEND_FROM_EMAIL. Use
  // `fromTrainer({ name, email })` to build a from-spoof header that
  // looks like the trainer but stays on our verified sender domain.
  from?: string
  replyTo?: string | string[]
}

export async function sendEmail({ to, subject, html, text, from, replyTo }: SendArgs) {
  return client().emails.send({
    from: from ?? PLATFORM_FROM,
    to,
    subject,
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
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
