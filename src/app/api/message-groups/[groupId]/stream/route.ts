import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getGroupAccess } from '@/lib/message-group-access'
import { visibleMessagesWhere, REMOVED_MEMBER_LABEL } from '@/lib/message-groups'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Server-Sent Events for ONE group thread — the sibling of
// /api/messages/stream, which is keyed per client. Same shape deliberately:
// DB polling, no in-process emitter, so it works unchanged across serverless
// instances. Left as a separate route rather than bolted onto the 1:1 stream
// because that one is load-bearing and works; the two share nothing but the
// pattern.
//
// The authorisation and the visibility filter are the SAME helpers the REST
// route uses, so a client cannot receive over the stream something the GET
// would have withheld — which is exactly how a privacy guarantee usually
// springs a leak.

const POLL_INTERVAL_MS = 1000
const STREAM_MAX_MS = 250_000

export async function GET(_req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const access = await getGroupAccess(groupId)
  if (access instanceof NextResponse) return new Response('Forbidden', { status: 403 })
  // An unaccepted COMMUNITY invitation is not consent — no live feed of a
  // conversation they haven't agreed to join.
  if (!access.isTrainerSide && !access.participant?.joinedAt) {
    return new Response('Forbidden', { status: 403 })
  }

  const encoder = new TextEncoder()
  const startedAt = Date.now()
  let lastSeenAt = new Date()
  let closed = false

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      send('open', { ok: true })

      const heartbeat = setInterval(() => {
        if (closed) return
        controller.enqueue(encoder.encode(': ping\n\n'))
      }, 15_000)

      ;(async () => {
        try {
          while (!closed && Date.now() - startedAt < STREAM_MAX_MS) {
            await sleep(POLL_INTERVAL_MS)
            if (closed) break

            const fresh = await prisma.groupMessage.findMany({
              where: {
                groupId,
                createdAt: { gt: lastSeenAt },
                ...visibleMessagesWhere({ userId: access.userId, isTrainerSide: access.isTrainerSide }),
              },
              orderBy: { createdAt: 'asc' },
              select: {
                id: true, body: true, senderId: true, createdAt: true,
                visibility: true, replyToId: true,
              },
            })
            if (fresh.length === 0) continue
            lastSeenAt = fresh[fresh.length - 1].createdAt

            // Resolve names through the participant rows — display name only,
            // and "Removed member" once someone has left.
            const senderIds = [...new Set(fresh.map(m => m.senderId))]
            const participants = await prisma.messageGroupParticipant.findMany({
              where: { groupId, userId: { in: senderIds } },
              select: { userId: true, displayName: true, leftAt: true },
            })
            const nameOf = new Map(
              participants.map(p => [p.userId, p.leftAt ? REMOVED_MEMBER_LABEL : p.displayName]),
            )

            for (const m of fresh) {
              send('message', {
                id: m.id,
                body: m.body,
                senderId: m.senderId,
                senderName: nameOf.get(m.senderId) ?? REMOVED_MEMBER_LABEL,
                createdAt: m.createdAt.toISOString(),
                visibility: m.visibility,
                replyToId: m.replyToId,
                isMine: m.senderId === access.userId,
              })
            }
          }
          send('reconnect', { reason: 'rotate' })
        } catch (err) {
          console.error('[group SSE]', err)
        } finally {
          clearInterval(heartbeat)
          if (!closed) {
            try { controller.close() } catch { /* already closed */ }
          }
        }
      })()
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
