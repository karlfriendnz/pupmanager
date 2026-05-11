'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Send } from 'lucide-react'

interface Message {
  id: string
  body: string
  senderId: string
  createdAt: string
  sender: { name: string | null; email: string }
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Real-time subscription via Server-Sent Events. Pulls new messages
  // for this thread as they hit the DB and dedups against the local
  // list (handles the overlap with optimistic inserts from this user).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const es = new EventSource(`/api/messages/stream?clientId=${encodeURIComponent(clientId)}`)
    es.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data) as Message
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
      } catch { /* ignore malformed events */ }
    })
    return () => { es.close() }
  }, [clientId])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setError(null)
    const text = body.trim()
    setBody('')

    // Optimistic insert under a tagged temp id so the bubble shows up
    // instantly; server reply swaps it for the persisted row. On
    // failure we yank the optimistic row and restore the input.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimistic: Message = {
      id: tempId,
      body: text,
      senderId: currentUserId,
      createdAt: new Date().toISOString(),
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
        setBody(text)
      }
    })
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Messages — `min-h-0` so flex-1 height takes precedence over
          intrinsic content height; otherwise overflow-y-auto can't kick
          in and the composer gets pushed off the bottom of the pane. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-8">No messages yet. Say hello!</p>
        )}
        {messages.map(msg => {
          const isMine = msg.senderId === currentUserId
          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-xs md:max-w-sm rounded-2xl px-4 py-2.5 text-sm ${
                isMine
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-slate-100 text-slate-900 rounded-bl-sm'
              }`}>
                <p className="break-words">{msg.body}</p>
                <p className={`text-xs mt-1 ${isMine ? 'text-blue-200' : 'text-slate-400'}`}>
                  {new Date(msg.createdAt).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer — sticky to the bottom of the thread pane, with safe-
          area-inset-bottom so the input clears the iOS home indicator
          even when the chat page claims back the surrounding pb-24. */}
      <div
        className="flex-shrink-0 sticky bottom-0 border-t border-slate-100 px-4 pt-3 bg-white"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
      >
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        <form onSubmit={sendMessage} className="flex gap-2">
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
    </div>
  )
}
