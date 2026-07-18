import { emailBodyToHtml } from '@/lib/email-html'
import { escapeHtml } from '@/lib/html-escape'

// Renders a platform announcement into a PupManager-branded email (teal strip →
// logo → the rich-builder body → unsubscribe footer). Mirrors the onboarding
// email shell so platform mail looks consistent. `bodyHtml` is the serialized
// block-builder HTML; it's sanitized here (same as the trainer/onboarding path).
export function renderAnnouncementEmail({
  subject,
  bodyHtml,
  unsubscribeUrl,
}: {
  subject: string
  bodyHtml: string
  unsubscribeUrl: string
}): { subject: string; html: string } {
  const body = emailBodyToHtml(bodyHtml)
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:700px;">
          <tr>
            <td style="background:#ffffff;border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);overflow:hidden;">
              <div style="height:4px;background:#2a9da9;"></div>
              <div style="padding:24px 28px 8px;text-align:center;">
                <img src="https://app.pupmanager.com/email-logo.png" alt="PupManager" width="190" style="display:inline-block;border:0;height:auto;max-width:190px;" />
              </div>
              <div style="padding:18px 28px 8px;">${body}</div>
              <div style="padding:18px 28px;background:#fafaf9;border-top:1px solid #f1f5f9;text-align:center;">
                <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">You're getting this because you use PupManager.<br />
                  <a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;text-decoration:underline;">Unsubscribe from product updates</a>
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 8px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#333333;letter-spacing:0.04em;text-transform:uppercase;">
                <a href="https://pupmanager.com" style="color:#333333;text-decoration:none;font-weight:600;">PupManager</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  return { subject, html }
}
