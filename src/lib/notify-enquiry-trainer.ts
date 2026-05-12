import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { sendEmail } from '@/lib/email'
import { env } from '@/lib/env'
import { resolvePref } from '@/lib/notification-prefs'
import { renderTemplate } from '@/lib/notification-types'
import { escapeHtml } from '@/lib/enquiries'

// Notify the trainer when a public form submission lands. Sends both a
// PUSH (in-pocket buzz with a preview) and an EMAIL (full details for
// replying from). Both are fire-and-forget — errors are swallowed and
// logged so a flaky APNs/Resend round-trip can't fail the public form.

interface NotifyArgs {
  enquiryId: string
}

export async function notifyEnquiryTrainer(args: NotifyArgs): Promise<void> {
  try {
    await doNotify(args)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.error('[notify-enquiry-trainer] failed:', msg)
  }
}

async function doNotify({ enquiryId }: NotifyArgs) {
  // Pull the freshly-created enquiry along with the trainer's user
  // info (we push the user, not the TrainerProfile). One round-trip
  // beats threading every field through the caller as arguments.
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

  // Build the values map up-front — same values feed push template
  // and the email body so the trainer sees consistent wording.
  const preview = previewMessage(enquiry.message ?? `${enquiry.name} just submitted your form.`)
  const values = {
    name: enquiry.name,
    email: enquiry.email,
    dogName: enquiry.dogName ?? '',
    preview,
  }

  await Promise.allSettled([
    sendPush(enquiryId, trainerUser.id, values),
    sendEnquiryEmail(enquiry, trainerUser),
  ])
}

async function sendPush(
  enquiryId: string,
  trainerUserId: string,
  values: Record<string, string>,
): Promise<void> {
  const pref = await resolvePref(trainerUserId, 'NEW_ENQUIRY', 'PUSH')
  if (!pref.enabled) return

  const tokens = await prisma.deviceToken.findMany({
    where: { userId: trainerUserId, platform: 'IOS' },
    select: { token: true },
  })
  if (tokens.length === 0) return

  const title = renderTemplate(pref.title, values)
  const body = renderTemplate(pref.body, values)

  const results = await sendApns(
    tokens.map(t => t.token),
    {
      alert: { title, body },
      customData: { type: 'new-enquiry', enquiryId, path: `/enquiries/${enquiryId}` },
    },
  )

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

async function sendEnquiryEmail(
  enquiry: EnquiryForEmail,
  trainerUser: { id: string; email: string | null },
): Promise<void> {
  if (!trainerUser.email) return
  const pref = await resolvePref(trainerUser.id, 'NEW_ENQUIRY', 'EMAIL')
  if (!pref.enabled) return

  const enquiryUrl = `${env.NEXT_PUBLIC_APP_URL}/enquiries/${enquiry.id}`
  const subject = `New enquiry from ${enquiry.name}${enquiry.dogName ? ` (${enquiry.dogName})` : ''}`

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
      <div style="margin-top:24px;padding:16px 20px;background:#f8fafc;border-left:3px solid #2563eb;border-radius:4px;">
        <p style="margin:0 0 8px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Message</p>
        <p style="margin:0;color:#0f172a;font-size:15px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(enquiry.message)}</p>
      </div>
    `
    : ''

  const text = [
    `New enquiry — ${enquiry.name}`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    ...(enquiry.message ? [`Message:`, enquiry.message, ''] : []),
    `Reply here: ${enquiryUrl}`,
  ].join('\n')

  await sendEmail({
    to: trainerUser.email,
    // Reply-To set to the enquirer so the trainer can just hit reply
    // and email them back — without exposing our platform address as
    // the user-visible sender.
    replyTo: enquiry.email,
    subject,
    text,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 16px;color:#0f172a;">
        <p style="margin:0 0 4px;color:#2563eb;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">🐾 New enquiry</p>
        <h1 style="margin:0 0 4px;font-size:24px;color:#0f172a;">${escapeHtml(enquiry.name)}${enquiry.dogName ? ` <span style="color:#64748b;font-weight:500;">· ${escapeHtml(enquiry.dogName)}</span>` : ''}</h1>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">Submitted to ${escapeHtml(enquiry.trainer.businessName)} via ${escapeHtml(enquiry.form?.title ?? 'a public form')}.</p>

        <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          ${rowsHtml}
        </table>

        ${messageBlock}

        <a href="${enquiryUrl}" style="display:inline-block;margin-top:28px;background:#2563eb;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;">
          Open enquiry →
        </a>

        <p style="margin-top:32px;color:#94a3b8;font-size:12px;line-height:1.5;">
          Hit reply to email ${escapeHtml(enquiry.name)} directly — your reply goes to ${escapeHtml(enquiry.email)}, not PupManager.
        </p>
      </div>
    `,
  })
}

function previewMessage(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= 120) return trimmed
  return trimmed.slice(0, 117) + '…'
}
