'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Send, Check, CheckCheck } from 'lucide-react'
import { BookingProposalCard } from '@/components/shared/booking-proposal-card'
import { latestProposalIds, type ThreadProposalDto } from '@/lib/thread-proposal'
import {
  ChatPhotos,
  PhotoAttachButton,
  PhotoDraftStrip,
  usePhotoDrafts,
} from '@/components/shared/chat-photos'
import type { ChatAttachmentDto } from '@/lib/message-attachments'

interface Message {
  id: string
  body: string
  senderId: string
  createdAt: string
  /** Set only when this message IS a counter-offer on a booking request. */
  proposal?: ThreadProposalDto | null
  /** Photos sent with it. Ids only — the blob path never leaves the server. */
  attachments?: ChatAttachmentDto[]
  // Stamped when the OTHER party opens the thread, so on our own messages it
  // is the client's read receipt. Null on an optimistic row until the POST
  // comes back.
  readAt: string | null
  sender: { name: string | null; email: string }
}

// Read receipt inside one of OUR bubbles. Same truth as the list's tick, but
// dressed for a blue background. `readAt` is the only delivery signal the
// schema keeps — there is no per-device ack — so an unread message says "Sent"
// rather than claiming it was delivered to a handset.
function ThreadTick({ readAt }: { readAt: string | null }) {
  const read = !!readAt
  return (
    <span
      data-testid="message-tick"
      data-read={read ? 'true' : 'false'}
      aria-label={read ? 'Read by the client' : 'Sent — not read yet'}
      title={read ? `Read ${new Date(readAt!).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Sent — not read yet'}
      className={`inline-flex items-center gap-1 ${read ? 'text-white' : 'text-blue-200'}`}
    >
      {read ? <CheckCheck className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Check className="h-3.5 w-3.5" strokeWidth={1.75} />}
      {read ? 'Read' : 'Sent'}
    </span>
  )
}

export function MessageThread({
  clientId,
  currentUserId,
  initialMessages,
}: {
  clientId: string
  currentUserId: string
  initialMessages: Message[]
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [body, setBody] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // The same hook the client side uses — one implementation, four mounts.
  const photos = usePhotoDrafts({ clientId })

  // Which counter-offers are still live. Presentation only — the approve route
  // refuses a superseded one regardless (see BookingProposalCard).
  const liveProposalIds = latestProposalIds(
    messages.map(m => m.proposal).filter((p): p is ThreadProposalDto => !!p),
  )

  // Opening the thread marks it read (server-side on load) — nudge the nav badge
  // to recount so it clears without waiting for the poll interval.
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('pm:refresh-unread')), 1200)
    return () => clearTimeout(t)
  }, [clientId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Real-time subscription via Server-Sent Events. Opens a long-lived
  // connection to /api/messages/stream which polls Postgres every 2s
  // for new rows in this thread and pushes them down. Receiver sees
  // new messages within ~2s without refreshing; sender already has
  // them locally via the optimistic insert, so dedup-by-id covers
  // the overlap.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const es = new EventSource(`/api/messages/stream?clientId=${encodeURIComponent(clientId)}`)
    es.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data) as Message
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
      } catch { /* ignore malformed events */ }
    })
    // The client opened the thread — flip our ticks to "Read" while the
    // trainer is still looking at it, rather than on the next page load.
    es.addEventListener('read', (ev) => {
      try {
        const { ids, readAt } = JSON.parse(ev.data) as { ids: string[]; readAt: string }
        const set = new Set(ids)
        setMessages(prev => prev.map(m => (set.has(m.id) && !m.readAt ? { ...m, readAt } : m)))
      } catch { /* ignore malformed events */ }
    })
    // Server rotates the connection ~every 4 minutes to dodge the
    // function timeout. EventSource reconnects automatically on
    // close, so we just need to close on unmount.
    return () => { es.close() }
  }, [clientId])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    const text = body.trim()
    const refs = photos.refs
    // A photo with no words is a message. Nothing at all is not.
    if (!text && refs.length === 0) return
    setError(null)
    setBody('')
    const localPhotos = photos.drafts
      .filter(d => d.status === 'ready')
      .map(d => ({ id: d.key, url: d.previewUrl, width: null, height: null }))
    photos.clear()

    // Optimistic: drop the message into the thread immediately under a
    // tagged temp id so the UI never waits on the API round-trip. The
    // server reply replaces the temp row with the real one (keyed by
    // tempId); a failure pulls the optimistic row back out and surfaces
    // an error so the trainer knows nothing was actually sent.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimistic: Message = {
      id: tempId,
      body: text,
      senderId: currentUserId,
      createdAt: new Date().toISOString(),
      readAt: null,
      sender: { name: null, email: '' },
      attachments: localPhotos,
    }
    setMessages(prev => [...prev, optimistic])

    startTransition(async () => {
      try {
        const res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, body: text, attachments: refs }),
        })
        if (!res.ok) throw new Error('send failed')
        const msg = await res.json() as Message
        setMessages(prev => prev.map(m => m.id === tempId ? msg : m))
      } catch {
        setError('Failed to send message.')
        setMessages(prev => prev.filter(m => m.id !== tempId))
        setBody(text) // restore so the trainer can retry without retyping
      }
    })
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Messages — `min-h-0` here too so the flex-1 sizing doesn't get
          overridden by the intrinsic content height, which would defeat
          overflow-y-auto and push the composer off-screen. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-8">No messages yet. Say hello!</p>
        )}
        {messages.map(msg => {
          const isMine = msg.senderId === currentUserId
          // A counter-offer renders as a card instead of a bubble — the times
          // and the two actions, in the run of the conversation.
          if (msg.proposal) {
            return (
              <BookingProposalCard
                key={msg.id}
                proposal={msg.proposal}
                viewerParty="TRAINER"
                isLatest={liveProposalIds.has(msg.proposal.id)}
                mine={isMine}
              />
            )
          }
          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div data-testid="message-bubble" data-mine={isMine ? 'true' : 'false'} className={`max-w-xs md:max-w-sm rounded-2xl px-4 py-2.5 text-sm ${
                isMine
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-slate-100 text-slate-900 rounded-bl-sm'
              }`}>
                {/* A photo-only message must read as a message, not as an
                    empty bubble with a timestamp. */}
                <ChatPhotos attachments={msg.attachments ?? []} className="mb-1.5" />
                {msg.body && <p className="break-words">{msg.body}</p>}
                <p className={`text-xs mt-1 flex items-center gap-1.5 ${isMine ? 'text-blue-200 justify-end' : 'text-slate-400'}`}>
                  {new Date(msg.createdAt).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}
                  {/* Only on OUR side: readAt on an incoming message just means
                      we opened the thread, which is not news. Sending rows have
                      no id from the server yet, so they say "Sending…". */}
                  {isMine && (
                    msg.id.startsWith('temp-')
                      ? <span className="text-blue-200/80">Sending…</span>
                      : <ThreadTick readAt={msg.readAt} />
                  )}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer — sticky to the bottom of the thread pane. flex-shrink-0
          stops it from collapsing if the messages list ever needs more
          room.
          Its vertical padding lives in `.pm-thread-composer` (globals.css),
          because who reserves the home-indicator strip depends on whether
          the pane is in flow or pinned to the visual viewport. */}
      <div className="pm-thread-composer flex-shrink-0 sticky bottom-0 border-t border-slate-100 px-4 bg-white">
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        <PhotoDraftStrip photos={photos} />
        <form onSubmit={sendMessage} className="flex gap-2">
          <PhotoAttachButton
            photos={photos}
            disabled={isPending}
            accentClassName="hover:border-blue-500 hover:text-blue-600"
          />
          <input
            type="text"
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Type a message…"
            className="flex-1 h-11 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            maxLength={2000}
          />
          {/* Send stays off while a photo is still going up — pressing it then
              would send the message without the picture. */}
          <Button
            type="submit"
            size="sm"
            loading={isPending || photos.busy}
            disabled={(!body.trim() && !photos.hasPhotos) || photos.busy}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}
