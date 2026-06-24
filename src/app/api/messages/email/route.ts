import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { sendEmail, fromTrainer } from '@/lib/email'
import { escapeHtml } from '@/lib/enquiries'
import { emailBodyToHtml, emailHtmlToText, htmlHasText } from '@/lib/email-html'

const schema = z.object({
  clientId: z.string().min(1),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(50_000), // rich-text HTML
})

// Compose & send a one-off email to a client from the Messages composer, and
// log it as an outbound Message so it shows in the thread history. Sends via the
// platform domain with a "Trainer via PupManager" From and the trainer's email
// as Reply-To, mirroring the enquiry-reply flow.
export async function POST(req: Request) {
  const guard = await guardPermission('messages.send')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  if (!htmlHasText(parsed.data.body)) return NextResponse.json({ error: 'Message body is empty' }, { status: 400 })

  const client = await prisma.clientProfile.findFirst({
    where: { id: parsed.data.clientId, trainerId },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { name: true } },
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
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!client.user.email) return NextResponse.json({ error: 'This client has no email address on file' }, { status: 422 })

  const displayName = client.trainer.user.name?.trim() || client.trainer.businessName
  const trainerEmail = client.trainer.user.email
  const businessName = client.trainer.businessName

  // Resolve the supported {{placeholders}}. Subject is plain text; body is HTML
  // (emailBodyToHtml sanitizes after substitution).
  const tokens: Record<string, string> = {
    clientName: client.user.name?.trim() || 'there',
    trainerName: displayName,
    businessName,
    dogName: client.dog?.name ?? '',
  }
  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => tokens[k] ?? `{{${k}}}`)

  const subject = fill(parsed.data.subject)
  const htmlBody = emailBodyToHtml(fill(parsed.data.body))
  const textBody = emailHtmlToText(fill(parsed.data.body))

  const validHex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
  const accentColor = client.trainer.emailAccentColor && validHex.test(client.trainer.emailAccentColor)
    ? client.trainer.emailAccentColor
    : '#0d9488'
  const logoUrl = client.trainer.logoUrl
  const safeBusiness = escapeHtml(businessName)
  const safeDisplay = escapeHtml(displayName)
  const initial = escapeHtml(businessName.charAt(0).toUpperCase())

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${safeBusiness}</title></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;">
        <tr><td style="background:#ffffff;border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);overflow:hidden;">
          <div style="height:4px;background:${accentColor};"></div>
          <div style="padding:32px 32px 16px;text-align:center;">
            ${logoUrl
              ? `<img src="${logoUrl}" alt="${safeBusiness}" style="max-height:88px;max-width:300px;display:inline-block;border:0;" />`
              : `<div style="display:inline-flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:18px;background:${accentColor};color:#ffffff;font-size:28px;font-weight:700;line-height:72px;">${initial}</div>`}
            <p style="margin:12px 0 0;font-size:14px;font-weight:600;color:#0f172a;letter-spacing:0.01em;">${safeBusiness}</p>
          </div>
          <div style="padding:8px 32px 32px;">${htmlBody}</div>
          <div style="padding:20px 32px;background:#fafaf9;border-top:1px solid #f1f5f9;">
            <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;"><strong style="color:#0f172a;">${safeDisplay}</strong><span style="color:#94a3b8;"> · ${safeBusiness}</span></p>
            <p style="margin:6px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">Hit reply to reach ${safeDisplay} directly.</p>
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

  try {
    await sendEmail({
      to: client.user.email,
      subject,
      from: fromTrainer(displayName),
      replyTo: trainerEmail,
      text: textBody,
      html,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[messages email]', msg)
    return NextResponse.json({ error: 'Email failed to send', detail: msg }, { status: 502 })
  }

  // Log to the thread so the trainer (and client app) sees the outbound email.
  const message = await prisma.message.create({
    data: {
      clientId: parsed.data.clientId,
      senderId: session.user.id,
      channel: 'TRAINER_CLIENT',
      body: `📧 ${subject}\n\n${textBody}`,
      bodyHtml: htmlBody,
    },
    include: { sender: { select: { name: true, email: true } } },
  })

  return NextResponse.json(message, { status: 201 })
}
