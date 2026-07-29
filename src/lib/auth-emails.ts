import { Resend } from 'resend'
import { fromTrainer } from './email'
import { DEFAULT_BRAND_COLOR } from './brand'

// A trainer's accent colour is free text on TrainerProfile, so it is validated
// before it reaches a style attribute — same guard the invite/notification
// renderers use.
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// Apple "Hide My Email" hands us a relay address (…@privaterelay.appleid.com).
// Our verification / drip / billing mail doesn't reliably reach those, so every
// Apple account must swap in a real, deliverable email. Single source of truth
// for "is this a private Apple relay address".
export function isPrivateRelayEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase().endsWith('@privaterelay.appleid.com')
}

interface VerificationEmailArgs {
  to: string
  name: string
  businessName: string
  code: string
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.pupmanager.com'

// Emails render in the recipient's mail client, OUTSIDE the app — so any image
// src must be a publicly reachable absolute URL. A dev origin like
// http://localhost:7777 can't be loaded by a mail client (the logo just comes
// up blank, which is exactly why signup emails looked "generic"). So for email
// assets we only trust an https origin and otherwise fall back to production.
function emailAssetOrigin(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL
  if (u && u.startsWith('https://')) return u.replace(/\/$/, '')
  return 'https://app.pupmanager.com'
}

/**
 * Sends the verification-code email used during signup. Branded layout with
 * PupManager's logo, a prominent code pill, and a one-click verify button
 * that pre-fills the code on /verify-account. The verify endpoint is the
 * single source of truth — both the manual code entry and the link click
 * resolve through the same flow.
 *
 * Best-effort sending: the caller should swallow + log errors so a Resend
 * hiccup doesn't fail the surrounding signup transaction.
 */
export async function sendVerificationEmail({
  to,
  name,
  businessName,
  code,
}: VerificationEmailArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const fromAddress = process.env.RESEND_FROM_EMAIL
  console.log('[auth-email] verification gate', {
    to,
    hasApiKey: !!apiKey,
    fromAddress: fromAddress ?? null,
  })
  if (!apiKey || !fromAddress) {
    console.warn('[auth-email] verification skipped — Resend env not configured')
    return
  }

  const firstName = name.split(' ')[0] || name
  const verifyUrl = `${APP_URL}/verify-account?email=${encodeURIComponent(to)}&code=${code}`
  // Always an https, publicly reachable wordmark — never the localhost origin.
  const logoUrl = `${emailAssetOrigin()}/email-logo.png`

  const resend = new Resend(apiKey)
  const result = await resend.emails.send({
    from: fromAddress,
    to,
    subject: `Your PupManager verification code: ${code}`,
    html: renderVerificationEmail({
      firstName,
      businessName,
      code,
      verifyUrl,
      logoUrl,
    }),
  })

  if (result.error) {
    console.error('[auth-email] Resend returned error', { to, error: result.error })
    throw new Error(result.error.message)
  }
  console.log('[auth-email] verification sent', { to, resendId: result.data?.id })
}

function renderVerificationEmail({
  firstName,
  businessName,
  code,
  verifyUrl,
  logoUrl,
}: {
  firstName: string
  businessName: string
  code: string
  verifyUrl: string
  logoUrl: string
}): string {
  // Inline styles only — every major email client strips <style> tags or
  // applies them inconsistently. Width capped at 560 with white card on a
  // light slate background.
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:20px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,0.04);">
          <!-- Brand header: teal wordmark on white -->
          <tr>
            <td align="center" style="padding:36px 32px 20px;background:#ffffff;">
              <img src="${escapeAttr(logoUrl)}" alt="PupManager" width="210" style="display:block;width:210px;max-width:66%;height:auto;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>
          <!-- Teal accent bar -->
          <tr>
            <td style="height:4px;line-height:4px;font-size:0;background:linear-gradient(90deg,#0d9488,#14b8a6,#2dd4bf);">&nbsp;</td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;line-height:1.3;">Welcome aboard, ${escapeHtml(firstName)}</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#475569;">
                Your <strong>${escapeHtml(businessName)}</strong> account is almost ready.
                Pop in the verification code below to finish setting things up — once you do,
                we'll walk you through your first client and your free trial begins.
              </p>

              <!-- Code pill -->
              <div style="margin:24px 0;text-align:center;">
                <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#64748b;font-weight:600;">Verification code</p>
                <div style="display:inline-block;padding:18px 32px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:14px;">
                  <span style="font-size:32px;font-weight:700;letter-spacing:0.4em;color:#0f766e;font-family:'SFMono-Regular',Menlo,Consolas,monospace;">
                    ${escapeHtml(code)}
                  </span>
                </div>
                <p style="margin:8px 0 0;font-size:12px;color:#94a3b8;">Expires in 10 minutes.</p>
              </div>

              <p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#475569;text-align:center;">
                Or tap the button to verify in one click:
              </p>

              <p style="margin:0 0 8px;text-align:center;">
                <a href="${escapeAttr(verifyUrl)}" style="display:inline-block;padding:14px 28px;background:#0d9488;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:600;font-size:15px;">
                  Verify my account
                </a>
              </p>

              <p style="margin:32px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:20px;">
                If this wasn't you, you can ignore this email — no account will be activated without the code above.
              </p>
            </td>
          </tr>
        </table>

        <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">
          PupManager · Made for dog trainers, in New Zealand 🇳🇿
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** The trainer whose brand a client-facing email wears. */
export interface VerificationEmailTrainer {
  businessName: string
  logoUrl: string | null
  emailAccentColor: string | null
}

interface ClientVerificationEmailArgs {
  to: string
  name: string
  /**
   * The trainer they asked to join, when they signed up from that trainer's
   * page. null = a generic PupManager signup, which is the ONE case where
   * PupManager branding is the honest answer.
   */
  trainer: VerificationEmailTrainer | null
  code: string
}

/**
 * The dog-owner twin of sendVerificationEmail. Same code + one-click link and
 * the same VerificationToken row, but the copy is written for someone who was
 * told "we use PupManager, go sign up" — no trial, no business setup, and an
 * honest line about what happens next (their trainer has to add them).
 *
 * WHITE LABEL: someone joining Mersea Mutts has never heard of PupManager, so
 * when we know the trainer this email wears THEIR logo, accent and name and is
 * written as them — the same shell as the invite/notification emails, with a
 * light "Sent with PupManager" line at the very bottom and nothing more.
 *
 * Confirming is NOT a gate: lib/auth.ts only blocks unverified TRAINERs, and
 * gating clients would lock out everyone a trainer ever added by hand. It
 * stamps User.emailVerified so we know the address is real.
 *
 * Best-effort, like its sibling — callers swallow + log.
 */
export async function sendClientVerificationEmail({
  to,
  name,
  trainer,
  code,
}: ClientVerificationEmailArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const fromAddress = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !fromAddress) {
    console.warn('[auth-email] client verification skipped — Resend env not configured')
    return
  }

  const firstName = name.split(' ')[0] || name
  const verifyUrl = `${APP_URL}/verify-account?email=${encodeURIComponent(to)}&code=${code}`
  const logoUrl = `${emailAssetOrigin()}/email-logo.png`

  const resend = new Resend(apiKey)
  const result = await resend.emails.send({
    // "Mersea Mutts via PupManager <noreply@pupmanager.com>" — the shared
    // helper keeps us on the verified sending domain (SPF/DKIM), so this needs
    // no env change.
    from: trainer ? fromTrainer(trainer.businessName) : fromAddress,
    to,
    subject: trainer
      ? `Confirm your email to join ${trainer.businessName}`
      : 'Confirm your PupManager email',
    html: renderClientVerificationEmail({ firstName, trainer, code, verifyUrl, logoUrl }),
  })

  if (result.error) {
    console.error('[auth-email] Resend returned error', { to, error: result.error })
    throw new Error(result.error.message)
  }
  console.log('[auth-email] client verification sent', { to, resendId: result.data?.id })
}

/**
 * Mirrors the trainer→client invite/notification email shell (see
 * lib/client-invite-email.ts) so every email a dog owner gets from their
 * trainer looks like the same business: accent strip, their logo (or an
 * initial tile when they haven't uploaded one), their name, and a light
 * "Sent with PupManager" line at the very bottom.
 *
 * With no trainer the shell falls back to PupManager's own wordmark and teal —
 * that path really is PupManager's, so branding it as such is honest.
 */
export function renderClientVerificationEmail({
  firstName,
  trainer,
  code,
  verifyUrl,
  logoUrl,
}: {
  firstName: string
  trainer: VerificationEmailTrainer | null
  code: string
  verifyUrl: string
  /** PupManager's own wordmark — used only when there is no trainer. */
  logoUrl: string
}): string {
  const accent =
    trainer?.emailAccentColor && HEX.test(trainer.emailAccentColor)
      ? trainer.emailAccentColor
      : DEFAULT_BRAND_COLOR

  const safeBusiness = trainer ? escapeHtml(trainer.businessName) : ''
  const initial = trainer ? escapeHtml(trainer.businessName.charAt(0).toUpperCase()) : ''

  // The trainer's own logo when they have one; their initial in the accent
  // colour when they don't — never PupManager's mark over a trainer's email.
  const brandMark = trainer
    ? (trainer.logoUrl
        ? `<img src="${escapeAttr(trainer.logoUrl)}" alt="${safeBusiness}" style="max-height:72px;max-width:260px;display:inline-block;border:0;" />`
        : `<div style="display:inline-flex;align-items:center;justify-content:center;width:60px;height:60px;border-radius:16px;background:${accent};color:#ffffff;font-size:24px;font-weight:700;line-height:60px;">${initial}</div>`)
    : `<img src="${escapeAttr(logoUrl)}" alt="PupManager" width="210" style="display:block;width:210px;max-width:66%;height:auto;border:0;outline:none;text-decoration:none;" />`

  const title = trainer
    ? `Confirm your email to join ${safeBusiness}`
    : `Hi ${escapeHtml(firstName)} 👋`

  const intro = trainer
    ? `Hi ${escapeHtml(firstName)} — thanks for signing up. We've let <strong>${safeBusiness}</strong> know you'd like to join. They'll add you to their client list, and you'll get an email the moment they do.`
    : `Your account is set up. To get started, ask your dog trainer for their sign-up link — once they add you, your sessions, notes and messages all show up here.`

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${trainer ? safeBusiness : 'PupManager'}</title>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your confirmation code is ${escapeHtml(code)}.</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;">
          <tr>
            <td style="background:#ffffff;border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);overflow:hidden;">
              <div style="height:4px;background:${accent};"></div>
              <div style="padding:28px 32px 8px;text-align:center;">
                ${brandMark}
                ${trainer ? `<p style="margin:10px 0 0;font-size:13px;font-weight:600;color:#94a3b8;letter-spacing:0.02em;">${safeBusiness}</p>` : ''}
              </div>

              <div style="padding:12px 32px 4px;text-align:center;">
                <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">${title}</h1>
                <p style="margin:0;font-size:15px;line-height:1.6;color:#475569;">${intro}</p>
              </div>

              <div style="padding:20px 32px 0;text-align:center;">
                <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#94a3b8;font-weight:600;">Confirm your email</p>
                <div style="display:inline-block;padding:18px 32px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;">
                  <span style="font-size:32px;font-weight:700;letter-spacing:0.4em;color:${accent};font-family:'SFMono-Regular',Menlo,Consolas,monospace;">${escapeHtml(code)}</span>
                </div>
                <p style="margin:8px 0 0;font-size:12px;color:#94a3b8;">Expires in 10 minutes.</p>
              </div>

              <div style="padding:20px 32px 8px;text-align:center;">
                <a href="${escapeAttr(verifyUrl)}" style="display:inline-block;padding:13px 28px;border-radius:12px;background:${accent};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;line-height:1;">Confirm my email</a>
              </div>
              <div style="padding:0 32px 24px;text-align:center;">
                <p style="margin:0;font-size:13px;line-height:1.5;color:#94a3b8;">
                  You can sign in straight away — confirming just tells us the address is really yours.
                </p>
              </div>

              <div style="padding:18px 32px;background:#fafaf9;border-top:1px solid #f1f5f9;">
                ${trainer
                  ? `<p style="margin:0;font-size:13px;color:#475569;line-height:1.5;"><strong style="color:#0f172a;">${safeBusiness}</strong></p>`
                  : ''}
                <p style="margin:${trainer ? '6px' : '0'} 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">
                  If this wasn't you, you can ignore this email.
                </p>
              </div>
            </td>
          </tr>
          ${trainer
            ? `<tr>
            <td style="padding:16px 8px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#333333;letter-spacing:0.04em;text-transform:uppercase;">
                Sent with <a href="https://pupmanager.com" style="color:#333333;text-decoration:none;font-weight:600;">PupManager</a>
              </p>
            </td>
          </tr>`
            : `<tr>
            <td style="padding:16px 8px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#94a3b8;">
                PupManager · Made for dog trainers, in New Zealand 🇳🇿
              </p>
            </td>
          </tr>`}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;')
}
