import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { renderTemplate, NOTIFICATION_TYPES } from '@/lib/notification-types'
import { resolvePref } from '@/lib/notification-prefs'
import type { NotificationType } from '@/generated/prisma'

const APP_URL = 'https://app.pupmanager.com'
const ACCENT = '#0d9488'

function shell(title: string, body: string, link?: string): string {
  const cta = link
    ? `<tr><td style="padding:8px 0 4px"><a href="${link}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px">Open PupManager</a></td></tr>`
    : ''
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(15,31,36,0.06)">
      <tr><td style="height:4px;background:${ACCENT}"></td></tr>
      <tr><td style="padding:22px 24px 24px">
        <p style="margin:0 0 14px;font-weight:700;color:${ACCENT};font-size:15px">PupManager</p>
        <h1 style="margin:0 0 8px;font-size:19px;line-height:1.3;color:#0f172a">${title}</h1>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#475569;white-space:pre-line">${body}</p>
        <table role="presentation" cellpadding="0" cellspacing="0">${cta}</table>
      </td></tr>
    </table>
    <p style="margin:14px 0 0;font-size:12px;color:#94a3b8">You can change which emails you get in Settings → Notifications.</p>
  </td></tr></table></body></html>`
}

/**
 * Send a trainer notification by EMAIL, honouring their per-type Email toggle
 * (and any custom copy). Fire-and-forget — never throws into the caller, so a
 * flaky email send can't fail the cron/request that triggered it. Pair this
 * with the existing push send in each notification path.
 */
export async function sendTrainerEmail(
  userId: string,
  type: NotificationType,
  subs: Record<string, string> = {},
  link: string = `${APP_URL}/dashboard`,
): Promise<void> {
  try {
    const meta = NOTIFICATION_TYPES[type]
    if (!meta || meta.audience === 'client' || !meta.channels.includes('EMAIL')) return
    const pref = await resolvePref(userId, type, 'EMAIL')
    if (!pref.enabled) return
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    if (!user?.email) return
    const title = renderTemplate(pref.title, subs)
    const body = renderTemplate(pref.body, subs)
    await sendEmail({ to: user.email, subject: title, html: shell(title, body, link), text: `${title}\n\n${body}\n\n${link}` })
  } catch (err) {
    console.error('[trainer-email] failed:', err instanceof Error ? err.message : 'unknown')
  }
}
