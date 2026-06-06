import { prisma } from '@/lib/prisma'
import { sendApns, INVALID_TOKEN_REASONS } from '@/lib/apns'
import { resolvePref } from '@/lib/notification-prefs'
import { renderTemplate } from '@/lib/notification-types'
import { sendTrainerEmail } from '@/lib/trainer-notify'

const APP_URL = 'https://app.pupmanager.com'

// Push the recipient of a freshly-created Message. "Recipient" = whichever
// party in the trainer↔client thread didn't send it. Fire-and-forget from
// the caller's perspective — errors are swallowed and logged so a flaky
// APNs round-trip can't fail the message-create response.

interface NotifyArgs {
  messageId: string
  clientId: string
  senderId: string
  body: string
}

export async function notifyMessageRecipient(args: NotifyArgs): Promise<void> {
  try {
    await doNotify(args)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.error('[notify-message-recipient] failed:', msg)
  }
}

async function doNotify({ messageId, clientId, senderId, body }: NotifyArgs) {
  // Resolve the two parties: the client (User attached to ClientProfile)
  // and the trainer (User attached to the ClientProfile's trainer's
  // TrainerProfile). Whichever isn't `senderId` is the recipient.
  const profile = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: {
      userId: true,
      user: { select: { id: true, name: true, email: true } },
      trainer: {
        select: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  })
  if (!profile?.trainer?.user) return

  const clientUser = profile.user
  const trainerUser = profile.trainer.user
  const recipientUser =
    senderId === clientUser.id ? trainerUser
    : senderId === trainerUser.id ? clientUser
    : null
  const senderUser =
    senderId === clientUser.id ? clientUser
    : senderId === trainerUser.id ? trainerUser
    : null
  if (!recipientUser || !senderUser) return

  const senderName = senderUser.name ?? senderUser.email ?? 'Someone'
  const clientName = clientUser.name ?? clientUser.email ?? 'Your client'
  const preview = previewMessage(body)
  const subs = { senderName, clientName, preview }
  const isTrainerRecipient = recipientUser.id === trainerUser.id

  // Push — honour the recipient's NEW_MESSAGE push pref (defaults on, so a
  // client who's never opened settings still gets pushes).
  const pushPref = await resolvePref(recipientUser.id, 'NEW_MESSAGE', 'PUSH')
  if (pushPref.enabled) {
    const tokens = await prisma.deviceToken.findMany({
      where: { userId: recipientUser.id, platform: 'IOS' },
      select: { token: true },
    })
    if (tokens.length > 0) {
      // Deep-link target depends on which side the recipient is on.
      const path = isTrainerRecipient ? `/messages/${clientId}` : `/my-messages`
      const results = await sendApns(
        tokens.map(t => t.token),
        {
          alert: { title: renderTemplate(pushPref.title, subs), body: renderTemplate(pushPref.body, subs) },
          customData: { type: 'new-message', messageId, path },
        },
      )
      // GC tokens APNs reports as dead (uninstall, wipe, bundle-id mismatch).
      const stale = results
        .filter(r => !r.ok && r.reason && INVALID_TOKEN_REASONS.has(r.reason))
        .map(r => r.token)
      if (stale.length > 0) {
        await prisma.deviceToken.deleteMany({ where: { token: { in: stale } } })
      }
    }
  }

  // Email — only the trainer side, since NEW_MESSAGE is a trainer-facing type.
  if (isTrainerRecipient) {
    await sendTrainerEmail(trainerUser.id, 'NEW_MESSAGE', subs, `${APP_URL}/messages/${clientId}`)
  }
}

// 120 chars is enough to read the gist on the lock screen without making
// iOS truncate at an awkward boundary. Collapses newlines to spaces so a
// "Hi\n\nQuestion about…" doesn't show a blank line in the body.
function previewMessage(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= 120) return trimmed
  return trimmed.slice(0, 117) + '…'
}
