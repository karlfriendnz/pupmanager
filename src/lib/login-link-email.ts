// Branded magic-link email — the one trainers and (more often)
// clients see when they hit "Send login link" on /login. Mirrors the
// white-card-on-neutral-surface look used by the invite + enquiry-
// reply emails so all of PupManager's outbound mail feels like a
// family.
//
// When trainer context is provided (always the case for a client
// account, optionally for a trainer's own login) the email is
// dressed up *as the trainer*: their business name in the headline,
// their logo at the top, their accent colour on the strip + CTA,
// their name in the footer. Clients get an email that reads "Sarah
// Carter wants you back in {Pawsome Dog Training}", not "PupManager
// would like you to log in".
//
// When no trainer context is available (rare — a trainer logging
// themselves in via magic link), we fall back to PupManager
// branding.

import { escapeHtml } from './enquiries'

export interface LoginLinkTrainer {
  businessName: string
  logoUrl: string | null
  emailAccentColor: string | null
  user: { name: string | null; email: string }
}

export interface LoginLinkEmailArgs {
  /** The verification URL NextAuth handed us. Tap = signed in. */
  url: string
  /** Recipient's name (null = email-only user, address it casually). */
  recipientName: string | null
  /** Trainer to brand the email as. Null falls back to PupManager. */
  trainer: LoginLinkTrainer | null
}

export interface RenderedLoginLink {
  subject: string
  html: string
  text: string
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.pupmanager.com'
const DEFAULT_ACCENT = '#7c3aed'
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function renderLoginLinkEmail({ url, recipientName, trainer }: LoginLinkEmailArgs): RenderedLoginLink {
  const businessName = trainer?.businessName ?? 'PupManager'
  const trainerDisplay = trainer?.user.name?.trim() || trainer?.businessName || null
  const logoUrl = trainer?.logoUrl ?? `${APP_URL}/logo.png`
  const accentColor = trainer?.emailAccentColor && HEX.test(trainer.emailAccentColor)
    ? trainer.emailAccentColor
    : DEFAULT_ACCENT

  const firstName = recipientName?.split(' ')[0]?.trim() || null
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,'

  // Subject voice swaps based on whether we know the trainer. Clients
  // see "Your sign-in link for {Pawsome}"; trainers logging into
  // their own dashboard see the platform-branded line.
  const subject = trainer
    ? `Your sign-in link for ${businessName}`
    : 'Your PupManager sign-in link'

  // Body opener. Trainer-branded version reads conversationally; the
  // generic PupManager fallback stays neutral.
  const opener = trainer && trainerDisplay
    ? `${trainerDisplay} sent you a one-tap sign-in link for ${escapeHtml(businessName)} on PupManager. Tap the button below — you'll be straight in, no password needed.`
    : `Tap the button below to sign in to PupManager. No password needed — the link does the work.`

  const safeBusiness = escapeHtml(businessName)
  const safeLogo = escapeHtml(logoUrl)
  const safeUrl = escapeHtml(url)
  const safeOpener = opener // already escaped where needed inside the template literal
  const safeTrainerLine = trainerDisplay
    ? `<strong style="color:#0f172a;">${escapeHtml(trainerDisplay)}</strong><span style="color:#94a3b8;"> · ${safeBusiness}</span>`
    : `<strong style="color:#0f172a;">PupManager</strong><span style="color:#94a3b8;"> · the trainer's app</span>`

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Tap to sign in to ${safeBusiness}. The link expires in 15 minutes.</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;">
          <tr>
            <td style="background:#ffffff;border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);overflow:hidden;">
              <div style="height:4px;background:${accentColor};"></div>
              <div style="padding:32px 32px 8px;text-align:center;">
                <img src="${safeLogo}" alt="${safeBusiness}" width="64" height="64" style="display:inline-block;border:0;border-radius:14px;max-width:64px;max-height:64px;object-fit:cover;" />
                <p style="margin:14px 0 0;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#94a3b8;">${safeBusiness}</p>
                <h1 style="margin:6px 0 0;font-size:24px;font-weight:700;color:#0f172a;line-height:1.25;">${greeting}</h1>
              </div>
              <div style="padding:14px 32px 0;">
                <p style="margin:0;font-size:15px;line-height:1.6;color:#0f172a;">${safeOpener}</p>
              </div>
              <div style="padding:24px 32px 8px;text-align:center;">
                <a href="${safeUrl}" style="display:inline-block;padding:14px 30px;border-radius:12px;background:${accentColor};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;line-height:1;">Sign in${trainer ? ` to ${safeBusiness}` : ''}</a>
                <p style="margin:14px 0 0;font-size:12px;color:#94a3b8;">Link expires in 15 minutes.</p>
              </div>
              <div style="padding:18px 32px 24px;">
                <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;text-align:center;">
                  Trouble with the button? Paste this link into your browser:<br/>
                  <a href="${safeUrl}" style="color:#475569;word-break:break-all;">${safeUrl}</a>
                </p>
              </div>
              <div style="padding:18px 32px;background:#fafaf9;border-top:1px solid #f1f5f9;">
                <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;">
                  ${safeTrainerLine}
                </p>
                <p style="margin:6px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">
                  ${trainer
                    ? `Hit reply to reach ${escapeHtml(trainerDisplay ?? businessName)} directly.`
                    : `Didn't ask for this? You can safely ignore it — nothing happens until the button gets tapped.`}
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

  const text = `${greeting}

${trainer && trainerDisplay
  ? `${trainerDisplay} sent you a sign-in link for ${businessName} on PupManager.`
  : `Sign in to PupManager.`}

Sign in here:
${url}

This link expires in 15 minutes. If you didn't ask for it, you can safely ignore this email — nothing happens until the link is opened.

— ${trainerDisplay ?? 'PupManager'}`

  return { subject, html, text }
}
