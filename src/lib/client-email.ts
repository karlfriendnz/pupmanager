import { escapeHtml } from '@/lib/enquiries'
import { emailBodyToHtml, emailHtmlToText } from '@/lib/email-html'

// Shared renderer for trainer→client email. Used by BOTH the one-off Messages
// composer (`/api/messages/email`) and the bulk Clients-list broadcast
// (`/api/clients/email-bulk`) so the branding, placeholder substitution, and
// HTML shell are identical in either path.

export interface ClientEmailRecipient {
  // The client's display name (User.name); falls back to "there" in copy.
  name: string | null
  // The client's primary dog, used by {{dogName}}.
  dogName?: string | null
}

export interface ClientEmailTrainer {
  // Trainer's personal name OR business name — what shows as the from/sign-off.
  displayName: string
  businessName: string
  logoUrl: string | null
  emailAccentColor: string | null
}

export interface BuildClientEmailInput {
  recipient: ClientEmailRecipient
  trainer: ClientEmailTrainer
  // Plain-text subject; may contain {{placeholders}}.
  subject: string
  // Rich-text HTML body (TipTap output); may contain {{placeholders}}.
  body: string
  // When set, renders the "you're receiving this because…" reason line and an
  // Unsubscribe link in the footer. REQUIRED for bulk/marketing broadcasts;
  // omitted for transactional one-to-one messages (which are exempt).
  unsubscribeUrl?: string
  // Optional hero/header image (public URL) shown full-width at the top of the
  // card — the polish the admin onboarding emails have. Skipped when absent.
  headerImageUrl?: string | null
}

export interface BuiltClientEmail {
  subject: string
  // The full email-client-ready document (branded shell + body + footer).
  html: string
  // Just the rendered inner body (post-substitution), for logging to the
  // Messages thread where the shell would be redundant.
  bodyHtml: string
  text: string
}

const DEFAULT_ACCENT = '#0d9488'
const VALID_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// Resolve the supported {{placeholders}}. Subject is plain text; body is HTML
// (emailBodyToHtml sanitizes after substitution). Unknown tokens are left
// verbatim so a typo is visible rather than silently blanked.
export function fillPlaceholders(s: string, tokens: Record<string, string>): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => tokens[k] ?? `{{${k}}}`)
}

export function buildClientEmail({
  recipient,
  trainer,
  subject,
  body,
  unsubscribeUrl,
  headerImageUrl,
}: BuildClientEmailInput): BuiltClientEmail {
  const tokens: Record<string, string> = {
    clientName: recipient.name?.trim() || 'there',
    trainerName: trainer.displayName,
    businessName: trainer.businessName,
    dogName: recipient.dogName ?? '',
  }

  const filledSubject = fillPlaceholders(subject, tokens)
  const htmlBody = emailBodyToHtml(fillPlaceholders(body, tokens))
  const textBody = emailHtmlToText(fillPlaceholders(body, tokens))

  const accentColor =
    trainer.emailAccentColor && VALID_HEX.test(trainer.emailAccentColor)
      ? trainer.emailAccentColor
      : DEFAULT_ACCENT
  const logoUrl = trainer.logoUrl
  const safeBusiness = escapeHtml(trainer.businessName)
  const safeDisplay = escapeHtml(trainer.displayName)
  const initial = escapeHtml(trainer.businessName.charAt(0).toUpperCase())

  // Bulk sends carry a compliance footer (reason-for-receiving + unsubscribe);
  // transactional sends pass no unsubscribeUrl and skip it.
  const unsubscribeBlock = unsubscribeUrl
    ? `<p style="margin:10px 0 0;font-size:11px;color:#94a3b8;line-height:1.5;">You're receiving this because you're a client of ${safeBusiness}. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a> from these emails.</p>`
    : ''
  const unsubscribeText = unsubscribeUrl
    ? `\n\n—\nYou're receiving this because you're a client of ${trainer.businessName}. Unsubscribe: ${unsubscribeUrl}`
    : ''

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${safeBusiness}</title></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;">
        <tr><td style="background:#ffffff;border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);overflow:hidden;">
          <div style="height:4px;background:${accentColor};"></div>
          ${headerImageUrl ? `<img src="${escapeHtml(headerImageUrl)}" alt="" style="display:block;width:100%;max-height:280px;object-fit:cover;border:0;" />` : ''}
          <div style="padding:32px 32px 16px;text-align:center;">
            ${logoUrl
              ? `<img src="${escapeHtml(logoUrl)}" alt="${safeBusiness}" style="max-height:88px;max-width:300px;display:inline-block;border:0;" />`
              : `<div style="display:inline-flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:18px;background:${accentColor};color:#ffffff;font-size:28px;font-weight:700;line-height:72px;">${initial}</div>`}
            <p style="margin:12px 0 0;font-size:14px;font-weight:600;color:#0f172a;letter-spacing:0.01em;">${safeBusiness}</p>
          </div>
          <div style="padding:8px 32px 32px;">${htmlBody}</div>
          <div style="padding:20px 32px;background:#fafaf9;border-top:1px solid #f1f5f9;">
            <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;"><strong style="color:#0f172a;">${safeDisplay}</strong><span style="color:#94a3b8;"> · ${safeBusiness}</span></p>
            <p style="margin:6px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">Hit reply to reach ${safeDisplay} directly.</p>
            ${unsubscribeBlock}
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

  return { subject: filledSubject, html, bodyHtml: htmlBody, text: textBody + unsubscribeText }
}
