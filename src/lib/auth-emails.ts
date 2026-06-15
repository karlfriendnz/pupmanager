import { Resend } from 'resend'

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
  const logoUrl = `${APP_URL}/logo.png`

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
          <!-- Brand strip -->
          <tr>
            <td align="center" style="padding:32px 32px 16px;background:linear-gradient(135deg,#0d9488,#14b8a6);">
              <img src="${escapeAttr(logoUrl)}" alt="PupManager" width="56" height="56" style="display:block;border-radius:14px;background:#ffffff;padding:8px;" />
              <p style="margin:12px 0 0;color:#ecfeff;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">PupManager</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;line-height:1.3;">Welcome aboard, ${escapeHtml(firstName)} 🐾</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#475569;">
                Your <strong>${escapeHtml(businessName)}</strong> account is almost ready.
                Pop in the verification code below to finish setting things up — once you do,
                we'll walk you through your first client and a 14-day free trial starts.
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
