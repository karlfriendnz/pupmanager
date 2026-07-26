'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Send, Mail, X, Check, CheckCheck } from 'lucide-react'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { htmlHasText } from '@/lib/email-html'

interface Message {
  id: string
  body: string
  senderId: string
  createdAt: string
  // Stamped when the OTHER party opens the thread, so on our own messages it
  // is the client's read receipt. Null on an optimistic row until the POST
  // comes back.
  readAt: string | null
  sender: { name: string | null; email: string }
}

type EmailTemplate = { id: string; name: string; category: string | null; subject: string; body: string }

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

  // Opening the thread marks it read (server-side on load) — nudge the nav badge
  // to recount so it clears without waiting for the poll interval.
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('pm:refresh-unread')), 1200)
    return () => clearTimeout(t)
  }, [clientId])

  // ── Email composer (one-off branded email, logged to the thread) ──
  const [emailOpen, setEmailOpen] = useState(false)
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [editorKey, setEditorKey] = useState(0) // bump to remount the editor with new content
  const [emailSending, setEmailSending] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

  function openEmail() {
    setEmailError(null)
    setEmailSubject('')
    setEmailBody('')
    setEditorKey(k => k + 1)
    setEmailOpen(true)
    if (templates === null) {
      fetch('/api/email-templates')
        .then(r => r.json())
        .then(d => setTemplates(d.templates ?? []))
        .catch(() => setTemplates([]))
    }
  }

  function applyTemplate(id: string) {
    const t = templates?.find(x => x.id === id)
    if (!t) return
    setEmailSubject(t.subject)
    setEmailBody(t.body)
    setEditorKey(k => k + 1) // remount so the editor shows the template body
  }

  async function sendEmailMessage() {
    if (!emailSubject.trim() || !htmlHasText(emailBody)) {
      setEmailError('Subject and message are required.')
      return
    }
    setEmailSending(true)
    setEmailError(null)
    try {
      const res = await fetch('/api/messages/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, subject: emailSubject, body: emailBody }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to send email')
      setMessages(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data as Message])
      setEmailOpen(false)
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : 'Failed to send email')
    } finally {
      setEmailSending(false)
    }
  }

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
    if (!body.trim()) return
    setError(null)
    const text = body.trim()
    setBody('')

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
    }
    setMessages(prev => [...prev, optimistic])

    startTransition(async () => {
      try {
        const res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, body: text }),
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
          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div data-testid="message-bubble" data-mine={isMine ? 'true' : 'false'} className={`max-w-xs md:max-w-sm rounded-2xl px-4 py-2.5 text-sm ${
                isMine
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-slate-100 text-slate-900 rounded-bl-sm'
              }`}>
                <p className="break-words">{msg.body}</p>
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
          It does NOT pad env(safe-area-inset-bottom): `html[data-native]
          body` already pads it once for the whole app, and the tab bar
          the pane sits above pads it again for itself. Adding a third
          copy here is what left a band of white below the input. */}
      <div className="flex-shrink-0 sticky bottom-0 border-t border-slate-100 px-4 py-3 bg-white">
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        <form onSubmit={sendMessage} className="flex gap-2">
          <button
            type="button"
            onClick={openEmail}
            title="Send an email to this client"
            className="h-11 w-11 flex-shrink-0 grid place-items-center rounded-xl border border-slate-200 text-slate-500 hover:text-accent hover:border-accent transition-colors"
            aria-label="Compose email"
          >
            <Mail className="h-4 w-4" />
          </button>
          <input
            type="text"
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Type a message…"
            className="flex-1 h-11 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            maxLength={2000}
          />
          <Button type="submit" size="sm" loading={isPending} disabled={!body.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>

      {emailOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40"
          onClick={() => !emailSending && setEmailOpen(false)}
        >
          <div
            className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-accent" />
                <h2 className="text-base font-semibold text-slate-900">Email this client</h2>
              </div>
              <button type="button" onClick={() => setEmailOpen(false)} disabled={emailSending} className="text-slate-400 hover:text-slate-600" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-3 overflow-y-auto">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Start from a template</label>
                <select
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  defaultValue=""
                  onChange={e => { if (e.target.value) applyTemplate(e.target.value) }}
                  disabled={emailSending}
                >
                  <option value="">{templates === null ? 'Loading…' : templates.length ? 'Choose a template…' : 'No templates available'}</option>
                  {templates?.map(t => (
                    <option key={t.id} value={t.id}>{t.category ? `${t.category} — ${t.name}` : t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Subject</label>
                <input
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                  disabled={emailSending}
                  className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Message</label>
                <RichTextEditor key={editorKey} theme="light" value={emailBody} onChange={setEmailBody} minHeight={180} disabled={emailSending} />
              </div>
              {emailError && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">{emailError}</p>}
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-2">
              <p className="text-xs text-slate-400">Sent from your business name; replies go to your inbox.</p>
              <Button type="button" onClick={sendEmailMessage} loading={emailSending} className="self-end">
                {!emailSending && <Send className="h-4 w-4" />}
                Send email
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
