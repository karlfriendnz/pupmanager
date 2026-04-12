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

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setError(null)
    const text = body.trim()
    setBody('')
    startTransition(async () => {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, body: text }),
      })
      if (!res.ok) { setError('Failed to send message.'); return }
      const msg = await res.json()
      setMessages(prev => [...prev, msg])
    })
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
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

      {/* Input */}
      <div className="border-t border-slate-100 px-4 py-3">
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
