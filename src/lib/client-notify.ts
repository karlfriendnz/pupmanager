import { prisma } from '@/lib/prisma'
import { sendPush } from '@/lib/push'
import { sendEmail, fromTrainer } from '@/lib/email'
import { renderClientNotificationEmail } from '@/lib/client-notification-email'
import { NOTIFICATION_TYPES, renderTemplate } from '@/lib/notification-types'
import type { NotificationType, NotificationChannel } from '@/generated/prisma'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? 'https://app.pupmanager.com'

interface NotifyClientArgs {
  userId: string // the client's User.id (ClientProfile.userId)
  trainerId: string // the trainer who triggered it — brands the email
  type: NotificationType // a CLIENT_* type
  vars?: Record<string, string> // substituted into the type's title/body templates
  link?: string // in-app path — feed item href + push tap target (e.g. /my-sessions/123)
  ctaLabel?: string // email button label (defaults to "Open in PupManager")
  sessions?: { when: string }[] // optional session list — shown as a table in the email
  channels?: NotificationChannel[] // send ONLY via these (overrides prefs) — used by the reminder cron for per-lead routing
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

async function doNotify({ userId, trainerId, type, vars = {}, link, ctaLabel, sessions, channels }: NotifyClientArgs) {
  const meta = NOTIFICATION_TYPES[type]
  if (!meta || meta.audience !== 'client') return

  // A channel is on if: an explicit override was passed (per-lead routing), else
  // the client's stored row, else the type's default-on set.
  const override = channels ? new Set<NotificationChannel>(channels) : null
  const rows = override ? [] : await prisma.notificationPreference.findMany({ where: { userId, type } })
  const byChannel = new Map(rows.map(r => [r.channel, r]))
  const defaultOn = new Set<NotificationChannel>(meta.defaultChannels ?? meta.channels)
  const channelOn = (ch: NotificationChannel) => {
    if (!meta.channels.includes(ch)) return false
    if (override) return override.has(ch)
    const row = byChannel.get(ch)
    return row ? row.enabled : defaultOn.has(ch)
  }

  const title = renderTemplate(meta.defaults.title, vars)
  const body = renderTemplate(meta.defaults.body, vars)

  // App — the in-app notifications feed.
  if (channelOn('IN_APP')) {
    await prisma.notification.create({ data: { userId, type, title, body, link: link ?? null } })
  }

  // Push — iOS (APNs) + Android (FCM) via the unified sender.
  if (channelOn('PUSH')) {
    await sendPush(userId, { alert: { title, body }, customData: { type, path: link ?? '/my-notifications' } })
  }

  // Email — branded to the triggering trainer (logo, accent, business name).
  // The per-category EMAIL toggle (channelOn) is the sole control; the legacy
  // master notifyEmail flag no longer gates client notifications.
  //
  // Deferred-email types (e.g. new-message) skip the immediate email so the app
  // (push + in-app chat) is the first touch — a cron sends the email later only
  // if the client still hasn't read it. A forced `channels` override (that's how
  // the cron calls back in) bypasses the defer and sends the email now.
  const deferEmail = meta.emailDeferMinutes != null && !override
  if (channelOn('EMAIL') && !deferEmail) {
    const [user, trainer] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      prisma.trainerProfile.findUnique({
        where: { id: trainerId },
        select: { businessName: true, logoUrl: true, emailAccentColor: true, user: { select: { name: true, email: true } } },
      }),
    ])
    if (user?.email && trainer) {
      const email = renderClientNotificationEmail({
        trainer,
        title,
        body,
        detail: vars.detail ?? null,
        description: vars.description ?? null,
        sessions,
        ctaLabel: ctaLabel ?? 'Open in PupManager',
        ctaHref: `${APP_URL}${link ?? '/my-notifications'}`,
      })
      await sendEmail({
        to: user.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
        from: fromTrainer(email.displayName),
        replyTo: email.trainerEmail,
      })
    }
  }
}
