import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { sendEmail } from '@/lib/email'
import { NOTIFICATION_TYPES, renderTemplate } from '@/lib/notification-types'
import { resolvePref } from '@/lib/notification-prefs'
import { escapeHtml } from '@/lib/enquiries'
import type { NotificationType } from '@/generated/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Body: { type, channel, customTitle?, customBody? }
// The optional customTitle/customBody let the UI preview unsaved edits — if
// either is provided, we use them instead of the stored values, otherwise
// resolvePref fills in stored or default copy.
const schema = z.object({
  type: z.string(),
  channel: z.enum(['PUSH', 'EMAIL']),
  customTitle: z.string().max(200).optional(),
  customBody: z.string().max(500).optional(),
})

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

    const meta = NOTIFICATION_TYPES[parsed.data.type as NotificationType]
    if (!meta) return NextResponse.json({ error: 'Unknown type' }, { status: 400 })

    const resolved = await resolvePref(session.user.id, meta.type, parsed.data.channel)
    const titleTemplate = parsed.data.customTitle ?? resolved.title
    const bodyTemplate = parsed.data.customBody ?? resolved.body

    const title = `[Test] ${renderTemplate(titleTemplate, meta.sampleValues)}`
    const body = renderTemplate(bodyTemplate, meta.sampleValues)

    if (parsed.data.channel === 'EMAIL') {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { email: true, name: true },
      })
      if (!user?.email) {
        return NextResponse.json({
          ok: false,
          reason: 'no-email',
          message: "Your account doesn't have an email address — add one in account settings.",
        })
      }
      try {
        await sendEmail({
          to: user.email,
          subject: title,
          text: `${title}\n\n${body}\n\nThis is a test of the "${meta.label}" notification email. Real notifications won't have the [Test] prefix.`,
          html: renderTestEmailHtml({ label: meta.label, title, body, recipientName: user.name }),
        })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Email send failed'
        console.error('[test-notification email]', errMsg)
        return NextResponse.json({
          ok: false,
          reason: 'email-send-failed',
          message: errMsg,
        }, { status: 502 })
      }
      return NextResponse.json({
        ok: true,
        sent: 1,
        preview: { title, body },
        deliveredTo: user.email,
      })
    }

    const tokens = await prisma.deviceToken.findMany({
      where: { userId: session.user.id, platform: 'IOS' },
    })
    if (tokens.length === 0) {
      return NextResponse.json({ ok: false, reason: 'no-devices', message: 'No iOS devices registered. Open the app on iPhone, allow notifications, then try again.' })
    }

    // Pick a realistic deep-link path so tapping the test push lands on the
    // page the real notification would. For session-related types, link to the
    // user's most recent session (or fall back to /dashboard if none exist).
    const path = await deepLinkFor(session.user.id, meta.type)

    const results = await sendApns(tokens.map(t => t.token), {
      alert: { title, body },
      customData: { type: 'preview', notificationType: meta.type, path },
    })

    const stale = results.filter(r => !r.ok && r.reason && INVALID_TOKEN_REASONS.has(r.reason)).map(r => r.token)
    if (stale.length > 0) await prisma.deviceToken.deleteMany({ where: { token: { in: stale } } })

    const sent = results.filter(r => r.ok).length
    return NextResponse.json({
      ok: sent > 0,
      sent,
      failed: results.length - sent,
      preview: { title, body },
      details: results.map(r => ({ ok: r.ok, status: r.status, reason: r.reason })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, reason: 'crash', message }, { status: 500 })
  }
}

// Branded HTML for the email-channel test send. Mirrors the white-card-
// on-neutral-surface look used by the enquiry-reply email so all
// PupManager outbound mail feels like a family. Marked clearly as a
// test (banner + label) so a trainer who clicks "Send test email"
// twice doesn't think real notifications have started firing.
function renderTestEmailHtml({ label, title, body, recipientName }: {
  label: string
  title: string
  body: string
  recipientName: string | null
}): string {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.pupmanager.com'
  const greeting = recipientName ? `Hi ${recipientName.split(' ')[0]},` : 'Hi,'
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Test send for the "${escapeHtml(label)}" notification.</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;">
          <tr>
            <td style="background:#ffffff;border-radius:18px;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);overflow:hidden;">
              <div style="height:4px;background:#7c3aed;"></div>
              <div style="padding:18px 32px 0;">
                <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Test send</span>
                <span style="margin-left:8px;font-size:12px;color:#94a3b8;">${escapeHtml(label)}</span>
              </div>
              <div style="padding:18px 32px 4px;">
                <p style="margin:0 0 8px;font-size:13px;color:#475569;">${greeting}</p>
                <p style="margin:0 0 12px;font-size:13px;color:#475569;line-height:1.5;">
                  Here&rsquo;s what your <strong style="color:#0f172a;">${escapeHtml(label)}</strong> email will look like in the wild — substituted with sample data so you can see the layout. Real sends won&rsquo;t have the orange &ldquo;Test send&rdquo; tag.
                </p>
              </div>
              <div style="padding:0 32px 8px;">
                <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#0f172a;line-height:1.2;">${escapeHtml(title)}</h1>
                <p style="margin:0;font-size:16px;line-height:1.6;color:#0f172a;">${escapeHtml(body).replace(/\n/g, '<br />')}</p>
              </div>
              <div style="padding:24px 32px 32px;">
                <a href="${APP_URL}/settings#notifications" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#0f172a;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;">Notification settings</a>
              </div>
              <div style="padding:18px 32px;background:#fafaf9;border-top:1px solid #f1f5f9;">
                <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
                  This was a one-off test send triggered from your notification settings. You can change which channels are on (push / email) any time.
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
}

// Pick a representative deep-link target for a test push so tapping the
// notification on iPhone navigates to a realistic destination.
async function deepLinkFor(userId: string, type: NotificationType): Promise<string> {
  switch (type) {
    case 'SESSION_REMINDER':
    case 'SESSION_NOTES_REMINDER': {
      const trainerProfile = await prisma.trainerProfile.findUnique({
        where: { userId }, select: { id: true },
      })
      if (!trainerProfile) return '/dashboard'
      const recent = await prisma.trainingSession.findFirst({
        where: { trainerId: trainerProfile.id },
        orderBy: { scheduledAt: 'desc' },
        select: { id: true },
      })
      if (!recent) return '/schedule'
      return type === 'SESSION_NOTES_REMINDER'
        ? `/sessions/${recent.id}#notes`
        : `/sessions/${recent.id}`
    }
    case 'NEW_MESSAGE':
      return '/messages'
    case 'NEW_CLIENT_INVITE_ACCEPTED':
      return '/clients'
    case 'CLIENT_COMPLETED_TASKS':
      return '/dashboard'
    case 'DAILY_SUMMARY':
    default:
      return '/dashboard'
  }
}
