'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Lock, Send, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModalPortal } from '@/components/shared/modal-portal'
import { FlatBlock } from '@/components/shared/flat-list'

// One group, from the dog owner's side. Everything it shows comes from
// /api/message-groups/<id>/*, which is the only place the visibility rules live
// — this file never queries and never assumes.
//
// The screen it renders is decided by ONE flag: `group.joined`. False means a
// COMMUNITY invitation nobody has accepted, and the API deliberately hands back
// an empty thread and an empty member list for that case. So the consent screen
// is not a nicety painted over real content — there is no content to paint over.

interface GroupMessage {
  id: string
  body: string
  createdAt: string
  senderId: string
  senderName: string
  visibility: 'EVERYONE' | 'TRAINER_ONLY'
  replyToId: string | null
  isMine: boolean
}

interface GroupPayload {
  group: {
    id: string
    name: string
    mode: 'BROADCAST' | 'COMMUNITY'
    archivedAt?: string | null
    isTrainerSide: boolean
    joined: boolean
    canPost: boolean
    memberCount?: number
  }
  messages: GroupMessage[]
  participants: { id: string; displayName: string; role: string }[]
}

type MembershipAction = 'join' | 'leave' | 'rename'

export function GroupThread({
  groupId,
  initialName,
  initialDisplayName,
  businessName,
  currentUserId,
}: {
  groupId: string
  initialName: string
  initialDisplayName: string
  businessName: string
  currentUserId: string
}) {
  const router = useRouter()
  const [data, setData] = useState<GroupPayload | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/message-groups/${groupId}/messages`)
      if (!res.ok) throw new Error('load failed')
      setData((await res.json()) as GroupPayload)
    } catch {
      setFailed(true)
    }
  }, [groupId])

  useEffect(() => { void load() }, [load])

  // Opening the group moves its read watermark server-side — nudge the nav
  // badge to recount so it clears without waiting for the poll, exactly as the
  // 1:1 thread does.
  useEffect(() => {
    if (!data?.group.joined) return
    const t = setTimeout(() => window.dispatchEvent(new Event('pm:refresh-unread')), 1200)
    return () => clearTimeout(t)
  }, [data?.group.joined, groupId])

  if (failed) {
    return (
      <Shell name={initialName} sub={businessName}>
        <p className="px-4 py-8 text-center text-sm text-slate-500">
          We couldn’t open this group. Please try again.
        </p>
      </Shell>
    )
  }

  if (!data) {
    return (
      <Shell name={initialName} sub={businessName}>
        <p className="px-4 py-8 text-center text-sm text-slate-400">Loading…</p>
      </Shell>
    )
  }

  if (!data.group.joined) {
    return (
      <ConsentScreen
        groupId={groupId}
        groupName={data.group.name}
        businessName={businessName}
        initialDisplayName={initialDisplayName}
        onJoined={() => { setData(null); void load() }}
        onDeclined={() => router.push('/my-messages')}
      />
    )
  }

  return (
    <JoinedThread
      groupId={groupId}
      businessName={businessName}
      currentUserId={currentUserId}
      payload={data}
      setPayload={setData}
    />
  )
}

/** The chat-shaped page frame: pinned header, one scrolling region beneath it. */
function Shell({
  name,
  sub,
  action,
  children,
}: {
  name: string
  sub: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    // Mirrors the 1:1 thread: fills <main>'s flex column and reclaims the
    // mobile tab-bar gutter so the composer sits flush above the tabs.
    <div className="flex min-h-0 flex-1 flex-col -mb-24 md:mb-0">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-slate-100 bg-white px-2 py-3 pr-4">
        {/* Back replaces the menu on a detail screen (AGENTS.md). */}
        <Link
          href="/my-messages"
          aria-label="Back to messages"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full active:bg-slate-100"
        >
          <ArrowLeft className="h-5 w-5 text-slate-700" strokeWidth={1.75} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
          <p className="truncate text-xs text-slate-500">{sub}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

async function postMembership(groupId: string, action: MembershipAction, displayName?: string) {
  const res = await fetch(`/api/message-groups/${groupId}/membership`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...(displayName ? { displayName } : {}) }),
  })
  if (!res.ok) throw new Error('membership failed')
}

/**
 * The consent step for a COMMUNITY group.
 *
 * The requirements it is written against, in order of how badly each one goes
 * wrong if it slips:
 *   • default is OUT — nothing is pre-ticked and nothing joins on arrival;
 *   • it says SPECIFICALLY what other members will see, and specifically what
 *     they will not (the second half is what people actually worry about);
 *   • the display name is editable BEFORE joining, because after joining is too
 *     late — the others have already seen it;
 *   • plain, short sentences. This is the one screen where a client decides
 *     whether to be visible to strangers, and dense legal prose is how people
 *     end up agreeing to something they didn't read.
 */
function ConsentScreen({
  groupId,
  groupName,
  businessName,
  initialDisplayName,
  onJoined,
  onDeclined,
}: {
  groupId: string
  groupName: string
  businessName: string
  initialDisplayName: string
  onJoined: () => void
  onDeclined: () => void
}) {
  const [name, setName] = useState(initialDisplayName)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const chosen = name.trim()

  function join() {
    setError(null)
    startTransition(async () => {
      try {
        // Rename FIRST. If the join landed first, the name they're replacing
        // would already be the one the group saw.
        if (chosen && chosen !== initialDisplayName) {
          await postMembership(groupId, 'rename', chosen)
        }
        await postMembership(groupId, 'join')
        onJoined()
      } catch {
        setError('We couldn’t join you to this group. Please try again.')
      }
    })
  }

  function decline() {
    setError(null)
    startTransition(async () => {
      try {
        // "No thanks" is recorded, not just navigated away from — otherwise the
        // next roster refresh invites them all over again.
        await postMembership(groupId, 'leave')
        onDeclined()
      } catch {
        setError('We couldn’t save that. Please try again.')
      }
    })
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-10">
      {/* A way out that decides nothing. "No thanks" is an answer and gets
          recorded; backing out leaves the invitation where it was. */}
      <Link
        href="/my-messages"
        className="-ml-2 mb-2 inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-sm text-slate-600 active:bg-slate-100"
      >
        <ArrowLeft className="h-4 w-4 text-slate-700" strokeWidth={1.75} />
        Messages
      </Link>
      <div className="mb-4 flex items-start gap-3">
        <Users className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight text-slate-900">{groupName}</h1>
          <p className="mt-0.5 text-sm text-slate-500">{businessName} invited you to this group</p>
        </div>
      </div>

      <FlatBlock>
        <div className="px-4 py-4">
          <p className="text-sm font-semibold text-slate-900">This is a group chat</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Everyone in this group can see each other. If you join, the other members will see:
          </p>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-slate-700">
            <li>• The name you pick below.</li>
            <li>• Everything you post in the group.</li>
          </ul>
        </div>
        <div className="px-4 py-4">
          <p className="text-sm font-semibold text-slate-900">What they will not see</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Other members never see your email address, your phone number, your address,
            or anything about your dog. Only {businessName} has those.
          </p>
        </div>
        <div className="px-4 py-4">
          <label htmlFor="group-display-name" className="text-sm font-semibold text-slate-900">
            The name others will see
          </label>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            You can change this. Use a first name, a nickname — whatever you like.
          </p>
          <input
            id="group-display-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={40}
            className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div className="px-4 py-4">
          <p className="text-sm leading-relaxed text-slate-600">
            You can leave the group at any time. If you leave, nobody new sees your name again.
          </p>
        </div>
      </FlatBlock>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {/* Two actions, neither of them preselected. Joining is the one that
          discloses something, so it does not get to be a default. */}
      <div className="mt-5 flex flex-col gap-2">
        <Button type="button" onClick={join} loading={pending} disabled={!chosen}>
          Join the group
        </Button>
        <Button type="button" variant="secondary" onClick={decline} disabled={pending}>
          No thanks
        </Button>
      </div>
    </div>
  )
}

function JoinedThread({
  groupId,
  businessName,
  currentUserId,
  payload,
  setPayload,
}: {
  groupId: string
  businessName: string
  currentUserId: string
  payload: GroupPayload
  setPayload: React.Dispatch<React.SetStateAction<GroupPayload | null>>
}) {
  const router = useRouter()
  const { group, messages, participants } = payload
  const [body, setBody] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [membersOpen, setMembersOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  // Bumped when the server rotates the stream, which re-runs the effect and
  // opens a fresh EventSource.
  const [streamKey, setStreamKey] = useState(0)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Live updates, same shape as the 1:1 thread's stream. The server applies the
  // SAME visibility filter the REST route does, so nothing arrives here that the
  // initial load would have withheld.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const es = new EventSource(`/api/message-groups/${encodeURIComponent(groupId)}/stream`)
    es.addEventListener('message', ev => {
      try {
        const msg = JSON.parse((ev as MessageEvent).data) as GroupMessage
        setPayload(prev =>
          prev && !prev.messages.some(m => m.id === msg.id)
            ? { ...prev, messages: [...prev.messages, msg] }
            : prev,
        )
      } catch { /* ignore malformed events */ }
    })
    // The route closes the connection after ~4 minutes rather than holding a
    // serverless function open forever; this is its handshake for "open another".
    es.addEventListener('reconnect', () => {
      es.close()
      setStreamKey(k => k + 1)
    })
    return () => { es.close() }
  }, [groupId, streamKey, setPayload])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    setError(null)
    setBody('')

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimistic: GroupMessage = {
      id: tempId,
      body: text,
      createdAt: new Date().toISOString(),
      senderId: currentUserId,
      senderName: 'You',
      // A client's reply in a BROADCAST group is private to the business; in a
      // COMMUNITY group everyone sees it. Guessing it here only affects the
      // optimistic bubble's caption — the server decides the stored value.
      visibility: group.mode === 'COMMUNITY' ? 'EVERYONE' : 'TRAINER_ONLY',
      replyToId: null,
      isMine: true,
    }
    setPayload(prev => (prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev))

    startTransition(async () => {
      try {
        const res = await fetch(`/api/message-groups/${groupId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: text }),
        })
        if (!res.ok) throw new Error('send failed')
        const saved = (await res.json()) as GroupMessage
        setPayload(prev =>
          prev ? { ...prev, messages: prev.messages.map(m => (m.id === tempId ? saved : m)) } : prev,
        )
      } catch {
        setError('Failed to send message.')
        setPayload(prev =>
          prev ? { ...prev, messages: prev.messages.filter(m => m.id !== tempId) } : prev,
        )
        setBody(text)
      }
    })
  }

  const isCommunity = group.mode === 'COMMUNITY'

  return (
    <>
      <Shell
        name={group.name}
        sub={businessName}
        action={
          // A member list exists in COMMUNITY only. In BROADCAST a client must
          // never learn who else is in the group — the API sends no participants
          // for that mode, and there is no button here to ask for them.
          isCommunity ? (
            <button
              type="button"
              onClick={() => setMembersOpen(true)}
              className="flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-slate-600 active:bg-slate-100"
            >
              <Users className="h-4 w-4 text-slate-700" strokeWidth={1.75} />
              {participants.length}
            </button>
          ) : null
        }
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">No messages yet.</p>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.isMine ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-xs md:max-w-sm">
                {!msg.isMine && (
                  <p className="mb-0.5 px-1 text-[11px] font-medium text-slate-500">{msg.senderName}</p>
                )}
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm ${
                    msg.isMine
                      ? 'rounded-br-md bg-accent text-white'
                      : 'rounded-bl-md bg-white text-slate-700 shadow-sm'
                  }`}
                >
                  <p className="break-words">{msg.body}</p>
                  <p className={`mt-1 text-xs ${msg.isMine ? 'text-white/70' : 'text-slate-400'}`}>
                    {new Date(msg.createdAt).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                {/* In a BROADCAST group a reply goes only to the business. Say so
                    on the bubble — a client who assumes twelve strangers just
                    read their message will simply stop replying. */}
                {msg.isMine && msg.visibility === 'TRAINER_ONLY' && (
                  <p className="mt-0.5 px-1 text-right text-[11px] text-slate-400">
                    Only {businessName} can see this
                  </p>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div
          className="flex-shrink-0 border-t border-slate-100 bg-white px-4 pt-3"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
        >
          {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
          {group.canPost ? (
            <form onSubmit={send} className="flex gap-2">
              <input
                type="text"
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Type a message…"
                aria-label="Message"
                data-testid="client-group-input"
                className="h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                maxLength={2000}
              />
              <Button type="submit" size="sm" loading={pending} disabled={!body.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          ) : (
            <p className="flex items-center gap-2 py-2 text-sm text-slate-500">
              <Lock className="h-4 w-4 text-slate-700" strokeWidth={1.75} />
              This group is closed. You can still read it.
            </p>
          )}
        </div>
      </Shell>

      {membersOpen && (
        <MembersScreen
          groupId={groupId}
          businessName={businessName}
          participants={participants}
          onClose={() => setMembersOpen(false)}
          onLeft={() => router.push('/my-messages')}
        />
      )}
    </>
  )
}

/**
 * Who else is here, and the way out.
 *
 * A full screen rather than a dropdown (AGENTS.md), portaled to <body> so the
 * blurred header can't become its containing block, and it locks body scroll
 * for as long as it's open — a panel scrolling over a scrolling page is two
 * scrollbars, which is Karl's standing "never".
 */
function MembersScreen({
  groupId,
  businessName,
  participants,
  onClose,
  onLeft,
}: {
  groupId: string
  businessName: string
  participants: { id: string; displayName: string; role: string }[]
  onClose: () => void
  onLeft: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  function leave() {
    setError(null)
    startTransition(async () => {
      try {
        await postMembership(groupId, 'leave')
        onLeft()
      } catch {
        setError('We couldn’t take you out of the group. Please try again.')
      }
    })
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex flex-col bg-white">
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-slate-100 px-2 py-3 pr-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full active:bg-slate-100"
          >
            <X className="h-5 w-5 text-slate-700" strokeWidth={1.75} />
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
            {participants.length} {participants.length === 1 ? 'member' : 'members'}
          </p>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {/* Display names only. There is no email, no phone and no link to a
              profile in this payload — the API never sends them, and nothing
              here goes looking elsewhere. */}
          <FlatBlock>
            {participants.map(p => (
              <div key={p.id} className="px-4 py-3.5 text-sm text-slate-900">
                {p.displayName}
              </div>
            ))}
          </FlatBlock>

          <div className="mt-6">
            {confirming ? (
              <FlatBlock>
                <div className="px-4 py-4">
                  <p className="text-sm font-semibold text-slate-900">Leave this group?</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    You will stop getting its messages, and the other members will no longer
                    see your name. You can still message {businessName} directly.
                  </p>
                  {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
                  <div className="mt-3 flex flex-col gap-2">
                    <Button type="button" onClick={leave} loading={pending}>
                      Yes, leave the group
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
                      Stay in the group
                    </Button>
                  </div>
                </div>
              </FlatBlock>
            ) : (
              <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
                Leave group
              </Button>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
