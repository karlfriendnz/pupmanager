import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { sendEmail } from '@/lib/email'
import { env } from '@/lib/env'
import { resolvePref } from '@/lib/notification-prefs'
import { renderTemplate } from '@/lib/notification-types'
import { escapeHtml } from '@/lib/enquiries'

// Nudge the trainer when a NEW enquiry has gone unanswered past a follow-up
// threshold (6/18/24/36h — see the enquiry-followups cron). Same dual-channel
// shape as notifyEnquiryTrainer: a PUSH buzz plus an EMAIL with the full
// enquiry to reply from. Fire-and-forget — a flaky APNs/Resend round-trip is
// logged and swallowed so the cron keeps marching through the batch.

interface NotifyArgs {
  enquiryId: string
  // The threshold that just elapsed, in hours (6 | 18 | 24 | 36).
  hours: number
}

// Friendlier "how long it's waited" copy than a bare "36 hours".
function waitedLabel(hours: number): string {
  if (hours >= 36) return 'a day and a half'
  if (hours >= 24) return 'a day'
  return `${hours} hours`
}

export async function notifyEnquiryFollowup(args: NotifyArgs): Promise<void> {
  try {
    await doNotify(args)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.error('[notify-enquiry-followup] failed:', msg)
  }
}

async function doNotify({ enquiryId, hours }: NotifyArgs) {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    include: {
      trainer: {
        select: {
          businessName: true,
          user: { select: { id: true, email: true } },
        },
      },
      form: { select: { title: true } },
    },
  })
  if (!enquiry?.trainer.user) return

  const trainerUser = enquiry.trainer.user
  const waited = waitedLabel(hours)
  const values = {
    name: enquiry.name,
    email: enquiry.email,
    dogName: enquiry.dogName ?? '',
    waited,
    hours: String(hours),
  }

  await Promise.allSettled([
    sendPush(enquiryId, trainerUser.id, values),
    sendFollowupEmail(enquiry, trainerUser, waited),
  ])
}

async function sendPush(
  enquiryId: string,
  trainerUserId: string,
  values: Record<string, string>,
): Promise<void> {
  const pref = await resolvePref(trainerUserId, 'ENQUIRY_FOLLOWUP_REMINDER', 'PUSH')
  if (!pref.enabled) return

  const tokens = await prisma.deviceToken.findMany({
    where: { userId: trainerUserId, platform: 'IOS' },
    select: { token: true },
  })
  if (tokens.length === 0) return

  // Belt-and-braces fallback so iOS never shows the bare word "Notification"
  // if a stored pref row renders to an empty string.
  const rawTitle = renderTemplate(pref.title, values).trim()
  const rawBody = renderTemplate(pref.body, values).trim()
  const title = rawTitle || `Still waiting — ${values.name || 'an enquiry'}`
  const body =
    rawBody ||
    `${values.name || 'An enquiry'} has been waiting ${values.waited} with no reply.`

  const results = await sendApns(tokens.map(t => t.token), {
    alert: { title, body },
    customData: { type: 'enquiry-followup', enquiryId, path: `/enquiries/${enquiryId}` },
  })

  const stale = results
    .filter(r => !r.ok && r.reason && INVALID_TOKEN_REASONS.has(r.reason))
    .map(r => r.token)
  if (stale.length > 0) {
    await prisma.deviceToken.deleteMany({ where: { token: { in: stale } } })
  }
}

interface EnquiryForEmail {
  id: string
  name: string
  email: string
  phone: string | null
  dogName: string | null
  dogBreed: string | null
  message: string | null
  createdAt: Date
  trainer: { businessName: string }
  form: { title: string } | null
}

async function sendFollowupEmail(
  enquiry: EnquiryForEmail,
  trainerUser: { id: string; email: string | null },
  waited: string,
): Promise<void> {
  if (!trainerUser.email) return
  const pref = await resolvePref(trainerUser.id, 'ENQUIRY_FOLLOWUP_REMINDER', 'EMAIL')
  if (!pref.enabled) return

  const enquiryUrl = `${env.NEXT_PUBLIC_APP_URL}/enquiries/${enquiry.id}`
  const subject = `Still waiting — ${enquiry.name}${enquiry.dogName ? ` (${enquiry.dogName})` : ''} hasn't heard back`

  const rows: Array<[string, string]> = [
    ['Name', enquiry.name],
    ['Email', enquiry.email],
    ...(enquiry.phone ? [['Phone', enquiry.phone] as [string, string]] : []),
    ...(enquiry.dogName ? [['Dog', `${enquiry.dogName}${enquiry.dogBreed ? ` · ${enquiry.dogBreed}` : ''}`] as [string, string]] : []),
    ['Submitted', enquiry.createdAt.toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' })],
    ...(enquiry.form?.title ? [['Form', enquiry.form.title] as [string, string]] : []),
  ]

  const rowsHtml = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;color:#64748b;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:8px 12px;color:#0f172a;font-size:14px;">${escapeHtml(value)}</td>
    </tr>
  `).join('')

  const messageBlock = enquiry.message
    ? `
      <div style="margin-top:24px;padding:16px 20px;background:#f8fafc;border-left:3px solid #f59e0b;border-radius:4px;">
        <p style="margin:0 0 8px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Their message</p>
        <p style="margin:0;color:#0f172a;font-size:15px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(enquiry.message)}</p>
      </div>
    `
    : ''

  const text = [
    `Still waiting — ${enquiry.name}'s enquiry has been sitting for ${waited} with no reply.`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    ...(enquiry.message ? [`Message:`, enquiry.message, ''] : []),
    `Reply here: ${enquiryUrl}`,
  ].join('\n')

  await sendEmail({
    to: trainerUser.email,
    // Reply-To set to the enquirer so the trainer can just hit reply.
    replyTo: enquiry.email,
    subject,
    text,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 16px;color:#0f172a;">
        <p style="margin:0 0 4px;color:#d97706;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">⏰ Unanswered enquiry</p>
        <h1 style="margin:0 0 4px;font-size:24px;color:#0f172a;">${escapeHtml(enquiry.name)}${enquiry.dogName ? ` <span style="color:#64748b;font-weight:500;">· ${escapeHtml(enquiry.dogName)}</span>` : ''}</h1>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Their enquiry to ${escapeHtml(enquiry.trainer.businessName)} has been waiting <strong style="color:#0f172a;">${escapeHtml(waited)}</strong> with no reply. A quick note now keeps a warm lead from going cold.</p>

        <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          ${rowsHtml}
        </table>

        ${messageBlock}

        <a href="${enquiryUrl}" style="display:inline-block;margin-top:28px;background:#f59e0b;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;">
          Reply now →
        </a>

        <p style="margin-top:32px;color:#94a3b8;font-size:12px;line-height:1.5;">
          Hit reply to email ${escapeHtml(enquiry.name)} directly — your reply goes to ${escapeHtml(enquiry.email)}, not PupManager. These nudges stop as soon as you reply, accept or decline.
        </p>
      </div>
    `,
  })
}
