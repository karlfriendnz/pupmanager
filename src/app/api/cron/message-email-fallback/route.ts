import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyClient } from '@/lib/client-notify'
import { resolvePref } from '@/lib/notification-prefs'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'

export const dynamic = 'force-dynamic'

// App-first messaging: when a trainer messages a client we send push + in-app
// immediately but defer the email. This cron is the fallback — it emails the
// client only if they STILL haven't opened the chat (readAt null) after the
// defer window, so the email is a safety net rather than the first touch.
//
// Schedule via Supabase pg_cron (see the runbook), e.g. every 10 minutes.
const DEFER_MINUTES = NOTIFICATION_TYPES.CLIENT_NEW_MESSAGE.emailDeferMinutes ?? 60

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - DEFER_MINUTES * 60_000)
  const pending = await prisma.message.findMany({
    where: {
      channel: 'TRAINER_CLIENT',
      readAt: null,              // client hasn't opened the chat
      emailFallbackSentAt: null, // we haven't emailed about it yet
      createdAt: { lt: cutoff }, // older than the defer window
      client: { isSample: false }, // never email demo/sample clients
    },
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: {
      id: true,
      body: true,
      senderId: true,
      client: { select: { id: true, trainerId: true, userId: true } },
      sender: { select: { name: true, email: true } },
    },
  })

  // Group by thread (client profile) so a burst of unread messages becomes ONE
  // "you have unread messages" email, not one per message. Only client-recipient
  // messages count — drop any where the sender IS the client (client→trainer).
  const byClient = new Map<string, typeof pending>()
  for (const m of pending) {
    if (!m.client.userId || m.senderId === m.client.userId) continue
    const arr = byClient.get(m.client.id) ?? []
    arr.push(m)
    byClient.set(m.client.id, arr)
  }

  // Mark everything we considered as handled regardless, so the cron is O(new)
  // and never reprocesses the same message (incl. client→trainer rows skipped above).
  const consideredIds = pending.map(m => m.id)

  let emailed = 0
  for (const msgs of byClient.values()) {
    const latest = msgs[msgs.length - 1]
    const clientUserId = latest.client.userId!
    const pref = await resolvePref(clientUserId, 'CLIENT_NEW_MESSAGE', 'EMAIL')
    if (!pref.enabled) continue

    const senderName = latest.sender.name ?? latest.sender.email ?? 'Your trainer'
    const trimmed = latest.body.trim().replace(/\s+/g, ' ')
    const base = trimmed.length > 120 ? trimmed.slice(0, 117) + '…' : trimmed
    const preview = msgs.length > 1 ? `${base}  (+${msgs.length - 1} more)` : base

    await notifyClient({
      userId: clientUserId,
      trainerId: latest.client.trainerId,
      type: 'CLIENT_NEW_MESSAGE',
      vars: { senderName, preview },
      link: '/my-messages',
      ctaLabel: 'Open messages',
      channels: ['EMAIL'], // force email-only — bypasses the defer in client-notify
    })
    emailed++
  }

  if (consideredIds.length > 0) {
    await prisma.message.updateMany({
      where: { id: { in: consideredIds } },
      data: { emailFallbackSentAt: new Date() },
    })
  }

  return NextResponse.json({ ok: true, considered: consideredIds.length, threadsEmailed: emailed })
}
