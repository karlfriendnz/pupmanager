import { prisma } from './prisma'
import { messagePreview } from './message-preview'

/**
 * Everything that has passed between a trainer and one client, as one list.
 *
 * Three sources, because there are three ways a trainer reaches a client and
 * all three have to show up here:
 *   · bulk email broadcasts they received (with open/click status)
 *   · the trainer↔client message thread
 *   · notifications sent TO them — session notes, homework, reminders
 *
 * That third one matters. Sending session notes calls notifyClient(), which
 * writes a Notification and nothing else, so a trainer who had sent notes saw
 * no trace of them until it was added. Reported by a live customer as "no comms
 * show on clients who have had session notes sent".
 *
 * `take` is the caller's: the client profile wants the newest few for a card
 * and a "last spoken" date, the Comms page wants the history.
 */
export interface CommItemRow {
  id: string
  kind: 'email' | 'message'
  direction: 'inbound' | 'outbound'
  subject: string
  status: string | null
  date: string
}

export async function loadClientCommunications(clientId: string, take: number): Promise<CommItemRow[]> {
  const profile = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: { userId: true },
  })
  const perSource = Math.max(take, 1)
  const [broadcasts, messages, notifications] = await Promise.all([
    prisma.emailBroadcastRecipient.findMany({
      where: { clientProfileId: clientId },
      orderBy: { createdAt: 'desc' },
      take: perSource,
      select: { id: true, status: true, createdAt: true, broadcast: { select: { subject: true } } },
    }),
    prisma.message.findMany({
      where: { clientId, channel: 'TRAINER_CLIENT' },
      orderBy: { createdAt: 'desc' },
      take: perSource,
      // A photo-only message has an empty body — without the count its row in
      // the comms feed would have a blank subject line.
      select: {
        id: true, body: true, senderId: true, createdAt: true,
        _count: { select: { attachments: true } },
      },
    }),
    profile?.userId
      ? prisma.notification.findMany({
          where: { userId: profile.userId },
          orderBy: { createdAt: 'desc' },
          take: perSource,
          select: { id: true, title: true, createdAt: true, readAt: true },
        })
      : Promise.resolve([]),
  ])
  return mergeCommunications(broadcasts, messages, notifications, profile?.userId ?? null, take)
}

/** Pure — three already-fetched lists into one date-sorted feed. */
export function mergeCommunications(
  broadcasts: { id: string; status: string | null; createdAt: Date; broadcast: { subject: string } }[],
  messages: {
    id: string
    body: string
    senderId: string | null
    createdAt: Date
    /** Optional so existing callers/tests keep compiling; a photo-only message
     *  has an empty body and needs it. */
    _count?: { attachments: number }
  }[],
  notifications: { id: string; title: string; createdAt: Date; readAt: Date | null }[],
  clientUserId: string | null,
  limit: number,
): CommItemRow[] {
  return [
    ...broadcasts.map(e => ({
      id: `b-${e.id}`,
      kind: 'email' as const,
      direction: 'outbound' as const,
      subject: e.broadcast.subject,
      status: e.status as string | null,
      date: e.createdAt.toISOString(),
    })),
    ...messages.map(m => ({
      id: `m-${m.id}`,
      kind: m.body.startsWith('📧') ? ('email' as const) : ('message' as const),
      direction: m.senderId === clientUserId ? ('inbound' as const) : ('outbound' as const),
      subject: messagePreview({
        body: m.body.replace(/^📧\s*/, '').split('\n')[0].slice(0, 140),
        attachmentCount: m._count?.attachments,
      }),
      status: null as string | null,
      date: m.createdAt.toISOString(),
    })),
    ...notifications.map(n => ({
      id: `n-${n.id}`,
      kind: 'message' as const,
      // Always outbound: these are things WE sent them, never a reply.
      direction: 'outbound' as const,
      subject: n.title,
      // readAt is a real signal here — the client opened it in their app.
      status: (n.readAt ? 'OPENED' : 'SENT') as string | null,
      date: n.createdAt.toISOString(),
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit)
}
