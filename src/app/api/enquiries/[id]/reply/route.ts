import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail, fromTrainer } from '@/lib/email'
import { escapeHtml } from '@/lib/enquiries'

const schema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
})

// Send a reply to the enquirer. v1 is one-way: we send via Resend from the
// platform domain but with a "Trainer Name via PupManager" From and
// `Reply-To: trainer@theirbusiness.com` so any reply lands in the trainer's
// real inbox. v2 will swap this for OAuth'd Gmail/Microsoft sending.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const enquiry = await prisma.enquiry.findFirst({
    where: { id, trainerId },
    include: {
      trainer: {
        select: {
          businessName: true,
          logoUrl: true,
          emailAccentColor: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  })
  if (!enquiry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const displayName = enquiry.trainer.user.name?.trim() || enquiry.trainer.businessName
  const trainerEmail = enquiry.trainer.user.email
  const businessName = enquiry.trainer.businessName
  const logoUrl = enquiry.trainer.logoUrl
  // Page background is fixed across all outbound emails for visual consistency
  // with the rest of the app's neutral surface.
  const bgColor = '#F8FAFC'
  // Validate the stored accent colour at send time so a tampered DB value
  // can never inject CSS into the email.
  const validHex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
  const accentColor = enquiry.trainer.emailAccentColor && validHex.test(enquiry.trainer.emailAccentColor)
    ? enquiry.trainer.emailAccentColor
    : '#7c3aed'

  // Convert plain-text body to HTML preserving paragraph + line breaks.
  const htmlBody = parsed.data.body
    .split(/\n{2,}/)
    .map(para => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#0f172a;">${escapeHtml(para).replace(/\n/g, '<br />')}</p>`)
    .join('')

  const safeBusiness = escapeHtml(businessName)
  const safeDisplay = escapeHtml(displayName)
  const initial = escapeHtml(businessName.charAt(0).toUpperCase())

  // Email-safe HTML: inline styles only, table-free flow that survives
  // Gmail/Apple Mail/Outlook. Background tint behind a white card gives the
  // message room to breathe; an accent strip ties the brand colour to the
  // header without needing a logo upload.
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeBusiness}</title>
</head>
<body style="margin:0;padding:0;background:${bgColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeDisplay} sent you a message about your enquiry.</div>
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
              <div style="padding:8px 32px 32px;">
                ${htmlBody}
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

  try {
    await sendEmail({
      to: enquiry.email,
      subject: parsed.data.subject,
      from: fromTrainer(displayName),
      replyTo: trainerEmail,
      text: parsed.data.body,
      html,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[enquiries reply]', msg)
    return NextResponse.json({ error: 'Email failed to send', detail: msg }, { status: 502 })
  }

  const message = await prisma.enquiryMessage.create({
    data: {
      enquiryId: id,
      direction: 'OUTBOUND',
      subject: parsed.data.subject,
      bodyText: parsed.data.body,
      sentByUserId: session.user.id,
    },
  })

  // Mark viewed if not already, so a "reply without explicit open" still
  // clears the dashboard badge.
  if (!enquiry.viewedAt) {
    await prisma.enquiry.update({ where: { id }, data: { viewedAt: new Date() } })
  }

  return NextResponse.json({ ok: true, message })
}
