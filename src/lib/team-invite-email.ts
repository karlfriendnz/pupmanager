// Renders the branded email a business sends when inviting another trainer to
// join their team. Mirrors the client-invite shell (white card, accent strip,
// logo/initial, gradient CTA, "Sent with PupManager" footer) but with team copy.

import { escapeHtml } from '@/lib/enquiries'

interface TeamInviteArgs {
  inviteeName: string
  businessName: string
  inviterName: string
  roleLabel: string // "Manager" | "Staff"
  inviteUrl: string
  logoUrl?: string | null
  accentColor?: string | null
}

const VALID_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function renderTeamInviteEmail(args: TeamInviteArgs): { subject: string; text: string; html: string } {
  const { inviteeName, businessName, inviterName, roleLabel, inviteUrl, logoUrl } = args
  const accentColor = args.accentColor && VALID_HEX.test(args.accentColor) ? args.accentColor : '#7c3aed'
  const bgColor = '#F8FAFC'

  const safeBusiness = escapeHtml(businessName)
  const safeInviter = escapeHtml(inviterName)
  const safeInvitee = escapeHtml(inviteeName)
  const safeRole = escapeHtml(roleLabel.toLowerCase())
  const initial = escapeHtml(businessName.charAt(0).toUpperCase() || 'P')

  const subject = `${inviterName} invited you to join ${businessName} on PupManager`
  const text = `Hi ${inviteeName},\n\n${inviterName} has invited you to join ${businessName} as a ${roleLabel.toLowerCase()} on PupManager.\n\nAccept your invitation: ${inviteUrl}`

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeBusiness}</title>
</head>
<body style="margin:0;padding:0;background:${bgColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeInviter} invited you to join ${safeBusiness} on PupManager.</div>
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
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#0f172a;">Hi ${safeInvitee},</p>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#0f172a;"><strong>${safeInviter}</strong> has invited you to join <strong>${safeBusiness}</strong> as a ${safeRole} on PupManager — the app they use to run their dog-training business.</p>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#0f172a;">Accept below to set up your sign-in and get started.</p>
              </div>
              <div style="padding:8px 32px 32px;text-align:center;">
                <a href="${inviteUrl}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:${accentColor};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;line-height:1;">Join ${safeBusiness}</a>
              </div>
              <div style="padding:20px 32px;background:#fafaf9;border-top:1px solid #f1f5f9;">
                <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;">
                  <strong style="color:#0f172a;">${safeInviter}</strong>
                  <span style="color:#94a3b8;"> · ${safeBusiness}</span>
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

  return { subject, text, html }
}
