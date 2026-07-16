import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Server-Sent Events stream for the signed-in user's unread notification count —
// the "instant" version of the nav bell, matching the message-thread stream
// pattern. The client opens an EventSource; we poll the unread count every 2s
// (server-side) and push a `count` event only when it CHANGES, so the badge
// reacts near-instantly to a new notification (increment) AND to the user
// reading them (decrement), without a client-side poll. Capped at ~250s under
// Vercel's 300s limit; EventSource auto-reconnects for continuous coverage.
const POLL_INTERVAL_MS = 2000
const STREAM_MAX_MS = 250_000

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return new Response('Unauthorised', { status: 401 })
  const userId = session.user.id

  const encoder = new TextEncoder()
  const startedAt = Date.now()
  let closed = false
  let lastCount = -1 // force the first read to emit
  // Only toast notifications that arrive AFTER the stream opens (older ones were
  // already in the feed) — seed the cursor at connect time.
  let lastSeenAt = new Date()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      send('open', { ok: true })

      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': ping\n\n'))
      }, 15_000)

      ;(async () => {
        try {
          while (!closed && Date.now() - startedAt < STREAM_MAX_MS) {
            const [count, fresh] = await Promise.all([
              prisma.notification.count({ where: { userId, readAt: null } }),
              prisma.notification.findMany({
                where: { userId, createdAt: { gt: lastSeenAt } },
                orderBy: { createdAt: 'asc' },
                select: { id: true, title: true, body: true, type: true, link: true, createdAt: true },
              }),
            ])
            // Badge count (changes on both new notifications and reads).
            if (count !== lastCount) {
              lastCount = count
              send('count', { count })
            }
            // Fresh arrivals → the client pops a toast for each.
            if (fresh.length > 0) {
              lastSeenAt = fresh[fresh.length - 1].createdAt
              for (const n of fresh) {
                send('new', { id: n.id, title: n.title, body: n.body, type: n.type, link: n.link })
              }
            }
            await sleep(POLL_INTERVAL_MS)
          }
          // Ask the client to reconnect before we hit the function timeout.
          send('reconnect', { reason: 'rotate' })
        } catch (err) {
          console.error('[notifications SSE]', err)
        } finally {
          clearInterval(heartbeat)
          if (!closed) { try { controller.close() } catch { /* already closed */ } }
        }
      })()
    },
    cancel() { closed = true },
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
  return new Promise<void>(r => setTimeout(r, ms))
}
