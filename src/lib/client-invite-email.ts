// Shared renderer for the trainer→client invite email. Used by both the
// initial /api/clients/invite send and the /api/clients/[id]/reinvite
// nudge so the two emails stay byte-identical and we can iterate on
// the design in one place.

import { escapeHtml } from './enquiries'

export interface ClientInviteEmailArgs {
  clientName: string
  dogNames: string[]
  trainer: {
    businessName: string
    logoUrl: string | null
    emailAccentColor: string | null
    user: { name: string | null; email: string }
  }
  /** Plain-text body. Supports {{clientName}} + {{dogName}} placeholders. */
  bodyTemplate: string
  /** /invite?token=…&email=… link the trainer's client should land on. */
  inviteUrl: string
}

export interface RenderedClientInvite {
  subject: string
  html: string
  text: string
  /** "Sarah Carter via PupManager <noreply@pupmanager.com>" — already
   *  rendered by fromTrainer at the call site; surfaced here so the
   *  caller can pass it through unchanged. */
  displayName: string
  trainerEmail: string
}

const DEFAULT_ACCENT = '#7c3aed'
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function renderClientInviteEmail(args: ClientInviteEmailArgs): RenderedClientInvite {
  const { clientName, dogNames, trainer, bodyTemplate, inviteUrl } = args

  const dogNamesFormatted = dogNames.length === 1
    ? dogNames[0]
    : dogNames.slice(0, -1).join(', ') + ' and ' + dogNames[dogNames.length - 1]

  const personalised = bodyTemplate
    .replace(/\{\{clientName\}\}/g, clientName)
    .replace(/\{\{dogName\}\}/g, dogNamesFormatted)

  const displayName = trainer.user.name?.trim() || trainer.businessName
  const trainerEmail = trainer.user.email
  const businessName = trainer.businessName
  const logoUrl = trainer.logoUrl
  const bgColor = '#F8FAFC'
  const accentColor = trainer.emailAccentColor && HEX.test(trainer.emailAccentColor)
    ? trainer.emailAccentColor
    : DEFAULT_ACCENT

  const htmlBody = personalised
    .split(/\n{2,}/)
    .map(para => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#0f172a;">${escapeHtml(para).replace(/\n/g, '<br />')}</p>`)
    .join('')

  const safeBusiness = escapeHtml(businessName)
  const safeDisplay = escapeHtml(displayName)
  const initial = escapeHtml(businessName.charAt(0).toUpperCase())

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeBusiness}</title>
</head>
<body style="margin:0;padding:0;background:${bgColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeDisplay} invited you to join their training app.</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${bgColor};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;">
          <tr>
            <td style="background:#ffffff;border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);overflow:hidden;">
              <div style="height:4px;background:${accentColor};"></div>
              <div style="padding:32px 32px 16px;text-align:center;">
                ${logoUrl
                  ? `<img src="${logoUrl}" alt="${safeBusiness}" style="max-height:88px;max-width:300px;display:inline-block;border:0;" />`
                  : `<div style="display:inline-flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:18px;background:${accentColor};color:#ffffff;font-size:28px;font-weight:700;line-height:72px;">${initial}</div>`}
                <p style="margin:12px 0 0;font-size:14px;font-weight:600;color:#0f172a;letter-spacing:0.01em;">${safeBusiness}</p>
              </div>
              <div style="padding:8px 32px 8px;">
                ${htmlBody}
              </div>
              <div style="padding:8px 32px 32px;text-align:center;">
                <a href="${inviteUrl}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:${accentColor};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;line-height:1;">Join ${safeBusiness}</a>
              </div>
              <div style="padding:20px 32px;background:#fafaf9;border-top:1px solid #f1f5f9;">
                <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;">
                  <strong style="color:#0f172a;">${safeDisplay}</strong>
                  <span style="color:#94a3b8;"> · ${safeBusiness}</span>
                </p>
                <p style="margin:6px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">
                  Hit reply to this email to reach ${safeDisplay} directly.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 8px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#333333;letter-spacing:0.04em;text-transform:uppercase;">
                Sent with <a href="https://pupmanager.com" style="color:#333333;text-decoration:none;font-weight:600;">PupManager</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return {
    subject: `You've been invited to ${businessName} on PupManager`,
    html,
    text: `${personalised}\n\nJoin ${businessName}: ${inviteUrl}`,
    displayName,
    trainerEmail,
  }
}

// Default invite copy used when the trainer hasn't customised an
// inviteTemplate yet. Same wording the dashboard's "Invite a client"
// modal pre-fills, kept here so reinvite can fall back to it.
export const DEFAULT_INVITE_BODY =
  `Hi {{clientName}},

You're invited to join my training app, where I'll share session notes, training plans, and progress for {{dogName}}.

Tap the button below to set up your account — takes about 30 seconds.

Looking forward to working with you and {{dogName}}.`
