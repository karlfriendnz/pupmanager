import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { sendEmail } from '@/lib/email'
import { NOTIFICATION_TYPES, renderTemplate } from '@/lib/notification-types'
import { resolvePref } from '@/lib/notification-prefs'
import { escapeHtml } from '@/lib/enquiries'
import { renderWeeklySummaryEmail, type SessionRow, type TaskRow } from '@/lib/weekly-summary-email'
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
        select: {
          email: true,
          name: true,
          timezone: true,
          trainerProfile: { select: { businessName: true } },
        },
      })
      if (!user?.email) {
        return NextResponse.json({
          ok: false,
          reason: 'no-email',
          message: "Your account doesn't have an email address — add one in account settings.",
        })
      }

      // Rich-template types render their *real* email layout with
      // sample data so the trainer sees what production looks like.
      // Generic types fall back to the simple "test send" wrapper.
      const html = meta.type === 'WEEKLY_SUMMARY'
        ? renderSampleWeeklySummary({
            recipientName: user.name,
            businessName: user.trainerProfile?.businessName ?? 'Your training business',
            tz: user.timezone,
          })
        : renderTestEmailHtml({ label: meta.label, title, body, recipientName: user.name })

      const subject = meta.type === 'WEEKLY_SUMMARY'
        ? '[Test] Your week — 12 sessions done, $480 earned'
        : title

      try {
        await sendEmail({
          to: user.email,
          subject,
          text: `${title}\n\n${body}\n\nThis is a test of the "${meta.label}" notification email. Real notifications won't have the [Test] prefix.`,
          html,
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

// Renders the actual Sunday wrap-up email layout populated with
// realistic sample data (12 completed sessions, $480 earned, 8
// upcoming, 6 tasks). Same component as the cron uses, so what the
// trainer previews in the test send is exactly what they'll get on
// Sunday at 7pm in production.
function renderSampleWeeklySummary({ recipientName, businessName, tz }: {
  recipientName: string | null
  businessName: string
  tz: string
}): string {
  const now = new Date()
  // Anchor the sample week on the upcoming Sunday so the date strip
  // ("Sunday wrap-up · Mon X – Sun Y") reads naturally regardless of
  // when the trainer hits "Send test".
  const dow = now.getDay() // 0=Sun
  const daysToSunday = dow === 0 ? 0 : 7 - dow
  const sunday = new Date(now); sunday.setDate(now.getDate() + daysToSunday); sunday.setHours(19, 0, 0, 0)
  const monday = new Date(sunday); monday.setDate(sunday.getDate() - 6); monday.setHours(0, 0, 0, 0)
  const nextStart = new Date(sunday); nextStart.setDate(sunday.getDate() + 1); nextStart.setHours(0, 0, 0, 0)
  const nextEnd   = new Date(sunday); nextEnd.setDate(sunday.getDate() + 7); nextEnd.setHours(23, 59, 0, 0)

  // Shape sample rows so the table density looks real — mix of fully
  // wrapped sessions, ones missing notes, ones still to invoice.
  const sample = (offsetDays: number, hour: number, mins = 0): Date => {
    const d = new Date(monday); d.setDate(monday.getDate() + offsetDays); d.setHours(hour, mins, 0, 0); return d
  }

  const sessionsCompleted: SessionRow[] = [
    { scheduledAt: sample(0, 9),  title: 'Recall practice',     durationMins: 45, status: 'COMPLETED', invoicedAt: sample(0, 9), hasNotes: true,  clientName: 'Sarah Carter',  dogName: 'Bailey', packageName: '5-pack puppy starter' },
    { scheduledAt: sample(1, 14), title: 'Loose-lead walk',     durationMins: 60, status: 'COMPLETED', invoicedAt: null,         hasNotes: true,  clientName: 'Liz Reed',      dogName: 'Rusty',  packageName: null },
    { scheduledAt: sample(2, 10, 30), title: 'Drop-in class',  durationMins: 60, status: 'COMPLETED', invoicedAt: sample(2, 11, 30), hasNotes: false, clientName: 'Grace Wilshaw', dogName: 'Tilly',  packageName: 'Drop-in' },
    { scheduledAt: sample(3, 16), title: 'Reactivity 1-on-1',   durationMins: 75, status: 'COMPLETED', invoicedAt: sample(3, 17, 15), hasNotes: true,  clientName: 'James Wu',      dogName: 'Kona',   packageName: 'Reactivity 4-pack' },
    { scheduledAt: sample(4, 11), title: 'Walk & coach',        durationMins: 60, status: 'COMPLETED', invoicedAt: null,         hasNotes: false, clientName: 'Mia Flynn',     dogName: 'Pepper', packageName: 'Walk & coach 5-pack' },
    { scheduledAt: sample(5, 9),  title: 'Puppy fundamentals',  durationMins: 45, status: 'COMPLETED', invoicedAt: sample(5, 10), hasNotes: true,  clientName: 'Tom Aylward',   dogName: 'Mochi',  packageName: '5-pack puppy starter' },
  ]

  const nextWeekSessions: SessionRow[] = [
    { scheduledAt: new Date(nextStart.getTime() + 1*86400000 + 9*3600000),  title: 'Recall practice',    durationMins: 45, status: 'UPCOMING', invoicedAt: null, hasNotes: false, clientName: 'Sarah Carter', dogName: 'Bailey', packageName: '5-pack puppy starter' },
    { scheduledAt: new Date(nextStart.getTime() + 1*86400000 + 14*3600000), title: 'Loose-lead walk',    durationMins: 60, status: 'UPCOMING', invoicedAt: null, hasNotes: false, clientName: 'Liz Reed',     dogName: 'Rusty',  packageName: null },
    { scheduledAt: new Date(nextStart.getTime() + 2*86400000 + 11*3600000), title: 'Drop-in class',      durationMins: 60, status: 'UPCOMING', invoicedAt: null, hasNotes: false, clientName: 'Grace Wilshaw', dogName: 'Tilly',  packageName: 'Drop-in' },
    { scheduledAt: new Date(nextStart.getTime() + 3*86400000 + 16*3600000), title: 'Reactivity 1-on-1',  durationMins: 75, status: 'UPCOMING', invoicedAt: null, hasNotes: false, clientName: 'James Wu',      dogName: 'Kona',   packageName: 'Reactivity 4-pack' },
    { scheduledAt: new Date(nextStart.getTime() + 4*86400000 + 10*3600000), title: 'Walk & coach',       durationMins: 60, status: 'UPCOMING', invoicedAt: null, hasNotes: false, clientName: 'Mia Flynn',     dogName: 'Pepper', packageName: 'Walk & coach 5-pack' },
  ]

  const nextWeekTasks: TaskRow[] = [
    { date: new Date(nextStart.getTime() + 0*86400000), title: 'Daily 5-min sit-stay', clientName: 'Sarah Carter',  dogName: 'Bailey' },
    { date: new Date(nextStart.getTime() + 1*86400000), title: 'Place-bed practice',   clientName: 'Liz Reed',      dogName: 'Rusty' },
    { date: new Date(nextStart.getTime() + 2*86400000), title: 'Door-manners drill',   clientName: 'Grace Wilshaw', dogName: 'Tilly' },
    { date: new Date(nextStart.getTime() + 3*86400000), title: 'Decompression walk',   clientName: 'James Wu',      dogName: 'Kona' },
    { date: new Date(nextStart.getTime() + 4*86400000), title: 'Loose-lead reps',      clientName: 'Mia Flynn',     dogName: 'Pepper' },
    { date: new Date(nextStart.getTime() + 5*86400000), title: 'Recall in the yard',   clientName: 'Tom Aylward',   dogName: 'Mochi' },
  ]

  const trainerFirstName = (recipientName?.split(' ')[0] ?? 'there').trim() || 'there'

  const rendered = renderWeeklySummaryEmail({
    weekStart: monday,
    weekEnd: sunday,
    nextWeekStart: nextStart,
    nextWeekEnd: nextEnd,
    trainerFirstName,
    businessName,
    sessionsCompleted,
    revenueCents: 48000, // $480 — matches the marketing-aligned per-session prorate
    nextWeekSessions,
    nextWeekTasks,
    tz,
  })

  // Wrap the production email in a thin "this is a preview" banner so
  // the trainer doesn't think real Sunday-at-7pm sends have started.
  const banner = `<div style="max-width:600px;margin:24px auto -12px;padding:10px 16px;background:#fef3c7;border:1px solid #fde68a;border-radius:12px;color:#92400e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.4;">
  <strong>Test preview</strong> — this is what the Sunday wrap-up email will look like, populated with sample data. Real sends fire at 7pm Sunday in your local time.
</div>`

  return rendered.html.replace('<body', '<body data-test="weekly-summary"').replace('</head>', `</head>`).replace('<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">', `${banner}<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">`)
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
