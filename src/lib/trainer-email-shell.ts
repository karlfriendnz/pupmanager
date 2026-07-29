import { escapeHtml } from './html-escape'
import { DEFAULT_BRAND_COLOR } from './brand'

/**
 * The shell a client-facing email wears when it comes FROM a trainer.
 *
 * Someone joining Mersea Mutts has never heard of PupManager and doesn't need
 * to. Every email we send on a trainer's behalf should look like theirs: their
 * logo (or their initial in their colour), their name, their accent, and one
 * light "Sent with PupManager" line at the very bottom — nothing more.
 *
 * This exists because that markup was being copy-pasted per email, and the ones
 * nobody copied it into stayed PupManager-teal with an "Open PupManager"
 * button. A shared shell is how the next email gets it for free instead of
 * being found in an inbox screenshot later.
 */

const HEX = /^#[0-9a-fA-F]{6}$/

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

export interface EmailTrainerBrand {
  businessName: string
  logoUrl: string | null
  emailAccentColor: string | null
}

export function renderTrainerEmail({
  trainer,
  title,
  bodyHtml,
  ctaLabel,
  ctaUrl,
  preheader,
  footerNote,
}: {
  /**
   * Whose brand this wears. null = a genuinely PupManager-side email, which is
   * the one case our own branding is the honest answer — but this shell is for
   * trainer mail, so callers should pass a trainer whenever they know one.
   */
  trainer: EmailTrainerBrand
  title: string
  /** Already-escaped HTML for the message body — usually one or two <p>s. */
  bodyHtml: string
  ctaLabel?: string
  ctaUrl?: string
  /** The grey line inbox previews show before opening. */
  preheader?: string
  /** An extra line under the body, e.g. "Hit reply to reach Fiona directly." */
  footerNote?: string
}): string {
  const accent =
    trainer.emailAccentColor && HEX.test(trainer.emailAccentColor)
      ? trainer.emailAccentColor
      : DEFAULT_BRAND_COLOR

  const business = escapeHtml(trainer.businessName)
  const initial = escapeHtml(trainer.businessName.charAt(0).toUpperCase())

  // Their logo when they have one; their initial in their colour when they
  // don't. Never PupManager's mark over a trainer's email.
  const mark = trainer.logoUrl
    ? `<img src="${escapeAttr(trainer.logoUrl)}" alt="${business}" style="max-height:72px;max-width:260px;display:inline-block;border:0;" />`
    : `<div style="display:inline-block;width:60px;height:60px;border-radius:16px;background:${accent};color:#ffffff;font-size:24px;font-weight:700;line-height:60px;text-align:center;">${initial}</div>`

  const cta = ctaLabel && ctaUrl
    ? `<div style="padding:20px 32px 8px;text-align:center;">
                <a href="${escapeAttr(ctaUrl)}" style="display:inline-block;padding:13px 28px;border-radius:12px;background:${accent};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;line-height:1;">${escapeHtml(ctaLabel)}</a>
              </div>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${business}</title>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>` : ''}
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;">
          <tr>
            <td style="background:#ffffff;border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);overflow:hidden;">
              <div style="height:4px;background:${accent};"></div>
              <div style="padding:28px 32px 8px;text-align:center;">
                ${mark}
                <p style="margin:10px 0 0;font-size:13px;font-weight:600;color:#94a3b8;letter-spacing:0.02em;">${business}</p>
              </div>

              <div style="padding:12px 32px 4px;text-align:center;">
                <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">${escapeHtml(title)}</h1>
                <div style="margin:0;font-size:15px;line-height:1.6;color:#475569;">${bodyHtml}</div>
              </div>

              ${cta}

              ${footerNote ? `<div style="padding:16px 32px 0;text-align:center;"><p style="margin:0;font-size:13px;color:#94a3b8;">${escapeHtml(footerNote)}</p></div>` : ''}

              <div style="padding:24px 32px 28px;text-align:center;">
                <p style="margin:0;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#cbd5e1;">Sent with PupManager</p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
