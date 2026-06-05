import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { sendEmail } from '@/lib/email'
import { NOTIFICATION_TYPES, renderTemplate } from '@/lib/notification-types'
import type { NotificationType, NotificationChannel } from '@/generated/prisma'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? 'https://app.pupmanager.com'

interface NotifyClientArgs {
  userId: string // the client's User.id (ClientProfile.userId)
  type: NotificationType // a CLIENT_* type
  vars?: Record<string, string> // substituted into the type's title/body templates
  link?: string // in-app path — feed item href + push tap target (e.g. /my-sessions/123)
  emailHtml?: string // optional richer email body; otherwise built from title + body
}

// Fan a client notification out to whichever channels the client has enabled
// (in-app feed / push / email). Fire-and-forget: never throws into the caller
// so a flaky APNs/email round-trip can't fail the originating request.
export async function notifyClient(args: NotifyClientArgs): Promise<void> {
  try {
    await doNotify(args)
  } catch (err) {
    console.error('[notify-client] failed:', err instanceof Error ? err.message : 'unknown')
  }
}

async function doNotify({ userId, type, vars = {}, link, emailHtml }: NotifyClientArgs) {
  const meta = NOTIFICATION_TYPES[type]
  if (!meta || meta.audience !== 'client') return

  // A channel is on if the client has a row saying so, else the type's
  // default-on set (push+feed for most; email only where we opt it in).
  const rows = await prisma.notificationPreference.findMany({ where: { userId, type } })
  const byChannel = new Map(rows.map(r => [r.channel, r]))
  const defaultOn = new Set<NotificationChannel>(meta.defaultChannels ?? meta.channels)
  const channelOn = (ch: NotificationChannel) => {
    if (!meta.channels.includes(ch)) return false
    const row = byChannel.get(ch)
    return row ? row.enabled : defaultOn.has(ch)
  }

  const title = renderTemplate(meta.defaults.title, vars)
  const body = renderTemplate(meta.defaults.body, vars)

  // In-app feed.
  if (channelOn('IN_APP')) {
    await prisma.notification.create({ data: { userId, type, title, body, link: link ?? null } })
  }

  // Push (iOS).
  if (channelOn('PUSH')) {
    const tokens = await prisma.deviceToken.findMany({ where: { userId, platform: 'IOS' }, select: { token: true } })
    if (tokens.length > 0) {
      const results = await sendApns(tokens.map(t => t.token), {
        alert: { title, body },
        customData: { type, path: link ?? '/notifications' },
      })
      const stale = results.filter(r => !r.ok && r.reason && INVALID_TOKEN_REASONS.has(r.reason)).map(r => r.token)
      if (stale.length > 0) await prisma.deviceToken.deleteMany({ where: { token: { in: stale } } })
    }
  }

  // Email (also gated by the user's master notifyEmail switch).
  if (channelOn('EMAIL')) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, notifyEmail: true } })
    if (user?.email && user.notifyEmail) {
      await sendEmail({ to: user.email, subject: title, html: emailHtml ?? defaultEmailHtml(title, body, link) })
    }
  }
}

function defaultEmailHtml(title: string, body: string, link?: string): string {
  const cta = link
    ? `<p style="margin-top:20px"><a href="${APP_URL}${link}" style="background:#0d9488;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open in PupManager</a></p>`
    : ''
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#1e293b;max-width:480px">
    <h2 style="margin:0 0 8px">${title}</h2>
    <p style="margin:0;color:#475569">${body}</p>
    ${cta}
  </div>`
}
