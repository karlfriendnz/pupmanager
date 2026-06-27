import { escapeHtml } from '@/lib/enquiries'

// Branded "here's your free download" email for a lead-magnet sign-up. Mirrors
// the shell in client-email.ts but with a prominent Download button and the
// correct mailing-list footer + unsubscribe (a subscriber is NOT a client, so
// the "you're a client of…" copy there would be wrong).

export interface LeadMagnetEmailTrainer {
  displayName: string
  businessName: string
  logoUrl: string | null
  emailAccentColor: string | null
}

export interface BuildLeadMagnetEmailInput {
  subscriberName: string | null
  trainer: LeadMagnetEmailTrainer
  magnetTitle: string
  downloadUrl: string
  unsubscribeUrl: string
  // Trainer-customisable overrides; null/empty falls back to the default copy.
  emailSubject?: string | null
  emailIntro?: string | null
}

const DEFAULT_ACCENT = '#0d9488'
const VALID_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function buildLeadMagnetEmail({
  subscriberName,
  trainer,
  magnetTitle,
  downloadUrl,
  unsubscribeUrl,
  emailSubject,
  emailIntro,
}: BuildLeadMagnetEmailInput): { subject: string; html: string; text: string } {
  const accent = trainer.emailAccentColor && VALID_HEX.test(trainer.emailAccentColor) ? trainer.emailAccentColor : DEFAULT_ACCENT
  const business = escapeHtml(trainer.businessName)
  const display = escapeHtml(trainer.displayName)
  const initial = escapeHtml(trainer.businessName.charAt(0).toUpperCase())
  const name = subscriberName?.trim() || 'there'
  const title = escapeHtml(magnetTitle)
  const subject = emailSubject?.trim() || `Your free download: ${magnetTitle}`
  // Custom intro (plain text → escaped, newlines become <br>), or the default.
  const introHtml = emailIntro?.trim()
    ? escapeHtml(emailIntro.trim()).replace(/\n/g, '<br />')
    : `Thanks for signing up — here's your copy of <strong>${title}</strong>. Tap the button below to download it.`
  const introText = emailIntro?.trim() || `Thanks for signing up — here's your copy of ${magnetTitle}.`

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${business}</title></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;">
        <tr><td style="background:#ffffff;border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);overflow:hidden;">
          <div style="height:4px;background:${accent};"></div>
          <div style="padding:32px 32px 8px;text-align:center;">
            ${trainer.logoUrl
              ? `<img src="${escapeHtml(trainer.logoUrl)}" alt="${business}" style="max-height:88px;max-width:300px;display:inline-block;border:0;" />`
              : `<div style="display:inline-flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:18px;background:${accent};color:#ffffff;font-size:28px;font-weight:700;line-height:72px;">${initial}</div>`}
            <p style="margin:12px 0 0;font-size:14px;font-weight:600;color:#0f172a;letter-spacing:0.01em;">${business}</p>
          </div>
          <div style="padding:8px 32px 8px;">
            <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#0f172a;">Hi ${escapeHtml(name)},</p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">${introHtml}</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td align="center" style="padding:4px 0 8px;">
              <a href="${escapeHtml(downloadUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 28px;border-radius:12px;">Download ${title}</a>
            </td></tr></table>
            <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#64748b;">If the button doesn't work, copy this link into your browser:<br /><a href="${escapeHtml(downloadUrl)}" style="color:${accent};word-break:break-all;">${escapeHtml(downloadUrl)}</a></p>
          </div>
          <div style="padding:20px 32px;background:#fafaf9;border-top:1px solid #f1f5f9;">
            <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;"><strong style="color:#0f172a;">${display}</strong><span style="color:#94a3b8;"> · ${business}</span></p>
            <p style="margin:6px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">Hit reply to reach ${display} directly.</p>
            <p style="margin:10px 0 0;font-size:11px;color:#94a3b8;line-height:1.5;">You're receiving this because you signed up to ${business}'s mailing list. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a>.</p>
          </div>
        </td></tr>
        <tr><td style="padding:16px 8px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#333333;letter-spacing:0.04em;text-transform:uppercase;">Sent with <a href="https://pupmanager.com" style="color:#333333;text-decoration:none;font-weight:600;">PupManager</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = `Hi ${name},

${introText}

Download it here: ${downloadUrl}

— ${trainer.displayName}, ${trainer.businessName}

You're receiving this because you signed up to ${trainer.businessName}'s mailing list. Unsubscribe: ${unsubscribeUrl}`

  return { subject, html, text }
}
