import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { emailBodyToHtml, emailHtmlToText } from '@/lib/email-html'
import { sendPush } from '@/lib/push'
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
        <div style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#475569">${body}</div>
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
  companyId: string | null = null,
): Promise<void> {
  try {
    const meta = NOTIFICATION_TYPES[type]
    if (!meta || meta.audience === 'client' || !meta.channels.includes('EMAIL')) return
    const pref = await resolvePref(userId, type, 'EMAIL', companyId)
    if (!pref.enabled) return
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    if (!user?.email) return
    const title = renderTemplate(pref.title, subs)
    // pref.body may be rich-text HTML (EMAIL channel) or legacy plain text;
    // emailBodyToHtml handles both. emailHtmlToText derives the plain part.
    const rawBody = renderTemplate(pref.body, subs)
    await sendEmail({ to: user.email, subject: title, html: shell(title, emailBodyToHtml(rawBody), link), text: `${title}\n\n${emailHtmlToText(rawBody)}\n\n${link}` })
  } catch (err) {
    console.error('[trainer-email] failed:', err instanceof Error ? err.message : 'unknown')
  }
}

/**
 * Send a trainer notification on BOTH push and email, each gated by its own
 * per-type toggle. For event-driven trainer notifications (not the cron paths,
 * which already manage their own push). `path` is the in-app deep-link; the
 * email links to APP_URL + path. Fire-and-forget.
 */
export async function notifyTrainer(
  userId: string,
  type: NotificationType,
  subs: Record<string, string> = {},
  path: string = '/dashboard',
  companyId: string | null = null,
): Promise<void> {
  // In-app feed — a persistent row in the trainer's /notifications list (the
  // same Notification model the client feed uses). Only for types that list
  // IN_APP and only when the trainer hasn't turned that channel off. Without
  // this, trainer notifications were push+email ONLY — nothing landed in-system.
  try {
    const meta = NOTIFICATION_TYPES[type]
    if (meta && meta.audience !== 'client' && meta.channels.includes('IN_APP')) {
      const pref = await resolvePref(userId, type, 'IN_APP', companyId)
      if (pref.enabled) {
        await prisma.notification.create({
          data: { userId, type, title: renderTemplate(pref.title, subs), body: renderTemplate(pref.body, subs), link: path },
        })
      }
    }
  } catch (err) {
    console.error('[notify-trainer in-app] failed:', err instanceof Error ? err.message : 'unknown')
  }
  // Push
  try {
    const pushPref = await resolvePref(userId, type, 'PUSH', companyId)
    if (pushPref.enabled) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { notifyPush: true },
      })
      if (user?.notifyPush) {
        await sendPush(userId, {
          alert: { title: renderTemplate(pushPref.title, subs), body: renderTemplate(pushPref.body, subs) },
          customData: { type, path },
        })
      }
    }
  } catch (err) {
    console.error('[notify-trainer push] failed:', err instanceof Error ? err.message : 'unknown')
  }
  // Email — gated by the EMAIL toggle inside the helper.
  await sendTrainerEmail(userId, type, subs, `${APP_URL}${path}`, companyId)
}
