// Branded renderer for client notification emails (recap ready, added to a
// plan, reminders, changes). Mirrors the trainer→client invite email shell so
// every outbound email carries the trainer's logo, accent and business name.

import { escapeHtml } from './enquiries'

const DEFAULT_ACCENT = '#0d9488' // PupManager teal
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export interface ClientNotificationEmailArgs {
  trainer: {
    businessName: string
    logoUrl: string | null
    emailAccentColor: string | null
    user: { name: string | null; email: string }
  }
  /** Bold headline, e.g. "You're booked in" / "Your recap is ready". */
  title: string
  /** Main sentence under the headline. */
  body: string
  /** Optional muted sub-line, e.g. "6 sessions · Thursdays 6pm". */
  detail?: string | null
  /** Optional list of session date/times — rendered as a table (e.g. when a
   *  client is booked into a multi-session package/class). */
  sessions?: { when: string }[]
  /** Button label + absolute URL into the client app. */
  ctaLabel: string
  ctaHref: string
}

export interface RenderedClientNotification {
  subject: string
  html: string
  text: string
  displayName: string
  trainerEmail: string
}

export function renderClientNotificationEmail(args: ClientNotificationEmailArgs): RenderedClientNotification {
  const { trainer, title, body, detail, sessions, ctaLabel, ctaHref } = args

  const displayName = trainer.user.name?.trim() || trainer.businessName
  const businessName = trainer.businessName
  const accent = trainer.emailAccentColor && HEX.test(trainer.emailAccentColor) ? trainer.emailAccentColor : DEFAULT_ACCENT

  const safeBusiness = escapeHtml(businessName)
  const safeDisplay = escapeHtml(displayName)
  const safeTitle = escapeHtml(title)
  const safeBody = escapeHtml(body)
  const safeDetail = detail ? escapeHtml(detail) : null
  const initial = escapeHtml(businessName.charAt(0).toUpperCase())

  // Multi-session table (only when 2+ sessions are passed).
  const sessionTable = sessions && sessions.length > 1
    ? `<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="margin:18px 0 0;border-collapse:separate;border-spacing:0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <tr><td colspan="2" style="padding:8px 14px;background:${accent};color:#ffffff;font-size:12px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;">${sessions.length} sessions</td></tr>
        ${sessions.map((s, i) => `<tr style="background:${i % 2 ? '#ffffff' : '#f8fafc'};">
          <td style="padding:9px 14px;font-size:13px;color:#94a3b8;width:34px;border-top:1px solid #eef2f6;">${i + 1}</td>
          <td style="padding:9px 14px;font-size:14px;color:#0f172a;border-top:1px solid #eef2f6;">${escapeHtml(s.when)}</td>
        </tr>`).join('')}
      </table>`
    : ''

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeBusiness}</title>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeTitle} — ${safeBody}</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;">
          <tr>
            <td style="background:#ffffff;border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);overflow:hidden;">
              <div style="height:4px;background:${accent};"></div>
              <div style="padding:28px 32px 8px;text-align:center;">
                ${trainer.logoUrl
                  ? `<img src="${trainer.logoUrl}" alt="${safeBusiness}" style="max-height:72px;max-width:260px;display:inline-block;border:0;" />`
                  : `<div style="display:inline-flex;align-items:center;justify-content:center;width:60px;height:60px;border-radius:16px;background:${accent};color:#ffffff;font-size:24px;font-weight:700;line-height:60px;">${initial}</div>`}
                <p style="margin:10px 0 0;font-size:13px;font-weight:600;color:#94a3b8;letter-spacing:0.02em;">${safeBusiness}</p>
              </div>
              <div style="padding:12px 32px 4px;text-align:center;">
                <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">${safeTitle}</h1>
                <p style="margin:0;font-size:16px;line-height:1.6;color:#334155;">${safeBody}</p>
                ${safeDetail ? `<p style="margin:8px 0 0;font-size:14px;color:#94a3b8;">${safeDetail}</p>` : ''}
              </div>
              ${sessionTable ? `<div style="padding:4px 32px 0;">${sessionTable}</div>` : ''}
              <div style="padding:24px 32px 32px;text-align:center;">
                <a href="${ctaHref}" style="display:inline-block;padding:13px 28px;border-radius:12px;background:${accent};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;line-height:1;">${escapeHtml(ctaLabel)}</a>
              </div>
              <div style="padding:18px 32px;background:#fafaf9;border-top:1px solid #f1f5f9;">
                <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;">
                  <strong style="color:#0f172a;">${safeDisplay}</strong><span style="color:#94a3b8;"> · ${safeBusiness}</span>
                </p>
                <p style="margin:6px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">Hit reply to reach ${safeDisplay} directly.</p>
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
    subject: title,
    html,
    text: `${title}\n\n${body}${detail ? `\n${detail}` : ''}\n\n${ctaLabel}: ${ctaHref}`,
    displayName,
    trainerEmail: trainer.user.email,
  }
}
