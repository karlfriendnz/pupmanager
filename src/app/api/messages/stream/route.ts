import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Server-Sent Events stream for a single trainer↔client thread.
// Client opens an EventSource, this hands back a stream of new
// messages as they appear in the database. Two delivery levers:
//
//  1. Poll every 2 seconds and yield rows with `createdAt > lastSeen`.
//     2s is the sweet spot — fast enough to feel real-time, slow
//     enough to keep DB load low. Optimistic inserts on the sender
//     mean THEY don't care about latency anyway; this is for the
//     other party.
//
//  2. Cap the stream at ~250 seconds so we don't bump into Vercel's
//     300s function timeout. The EventSource auto-reconnects when
//     the server closes, so the client experiences continuous
//     real-time updates across reconnects.
//
// Auth is enforced against the requesting user — only the trainer
// who owns the client (or the client themselves) can open a stream
// for that thread. Anyone else gets a 403.

const POLL_INTERVAL_MS = 2000
const STREAM_MAX_MS = 250_000

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response('Unauthorised', { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) {
    return new Response('clientId required', { status: 400 })
  }

  // Authorize: the requesting user must be the trainer that owns this
  // client (or a co-manager) OR the client user themselves. Same rules
  // the POST /api/messages endpoint applies.
  const allowed = await isAllowed(session.user.id, clientId)
  if (!allowed) {
    return new Response('Forbidden', { status: 403 })
  }

  const encoder = new TextEncoder()
  const startedAt = Date.now()
  // Seed lastSeen with NOW so the first poll only returns messages
  // created after the stream opened. Initial messages were already
  // rendered server-side by the parent page.
  let lastSeenAt = new Date()
  let closed = false

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        if (closed) return
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        controller.enqueue(encoder.encode(payload))
      }

      // Initial handshake so the client knows we're connected — some
      // proxies otherwise buffer the response until the first byte.
      send('open', { ok: true })

      // Heartbeat ping keeps intermediaries (corporate proxies,
      // CDNs) from killing the idle connection. SSE comments
      // (lines starting with `:`) are valid no-op pings.
      const heartbeat = setInterval(() => {
        if (closed) return
        controller.enqueue(encoder.encode(': ping\n\n'))
      }, 15_000)

      // Poll loop — chunked sleep between polls so we can break out
      // promptly when the client disconnects or we hit the timeout.
      ;(async () => {
        try {
          while (!closed && Date.now() - startedAt < STREAM_MAX_MS) {
            await sleep(POLL_INTERVAL_MS)
            if (closed) break
            const fresh = await prisma.message.findMany({
              where: {
                clientId,
                channel: 'TRAINER_CLIENT',
                createdAt: { gt: lastSeenAt },
              },
              orderBy: { createdAt: 'asc' },
              include: { sender: { select: { name: true, email: true } } },
            })
            if (fresh.length > 0) {
              lastSeenAt = fresh[fresh.length - 1].createdAt
              for (const m of fresh) {
                send('message', {
                  id: m.id,
                  body: m.body,
                  senderId: m.senderId,
                  createdAt: m.createdAt.toISOString(),
                  sender: { name: m.sender.name, email: m.sender.email ?? '' },
                })
              }
            }
          }
          // Tell the client we're closing on our own terms so its
          // reconnect logic kicks in immediately rather than waiting
          // for the network layer to surface the disconnect.
          send('reconnect', { reason: 'rotate' })
        } catch (err) {
          console.error('[messages SSE]', err)
        } finally {
          clearInterval(heartbeat)
          if (!closed) {
            try { controller.close() } catch { /* already closed */ }
          }
        }
      })()
    },
    cancel() {
      // Triggered when the client disconnects (tab closed, route
      // navigated away, etc). Flag the poll loop to exit on its next
      // iteration so we stop billing CPU.
      closed = true
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Some reverse proxies buffer unless this is set.
      'X-Accel-Buffering': 'no',
    },
  })
}

async function isAllowed(userId: string, clientId: string): Promise<boolean> {
  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (trainerProfile) {
    const owned = await prisma.clientProfile.findFirst({
      where: { id: clientId, trainerId: trainerProfile.id },
      select: { id: true },
    })
    if (owned) return true
    // Co-managed clients — ClientShare uses sharedWithId for the
    // accessing trainer.
    const shared = await prisma.clientShare.findFirst({
      where: { clientId, sharedWithId: trainerProfile.id },
      select: { id: true },
    })
    if (shared) return true
  }
  // Client themselves: ClientProfile.userId matches
  const own = await prisma.clientProfile.findFirst({
    where: { id: clientId, userId },
    select: { id: true },
  })
  return !!own
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}
