'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, ChevronRight, Lock, Megaphone, MoreHorizontal, Send, Trash2,
  UserMinus, UserPlus, UsersRound,
} from 'lucide-react'
import { GroupComposer, type AudienceOption, type PickableClient } from './group-composer'
import { cn } from '@/lib/utils'
import {
  ChatPhotos,
  PhotoAttachButton,
  PhotoDraftStrip,
  usePhotoDrafts,
  type PhotoDraftsApi,
} from '@/components/shared/chat-photos'
import type { ChatAttachmentDto } from '@/lib/message-attachments'

// The trainer's view of one group.
//
// Three screens in one component because they are one journey: the thread, the
// "who said what" list for a broadcast post, and the private exchange with one
// person under that post. Karl's ask, in his words: see the broadcast, click
// it, see the people and their replies, and talk to that person from there.
//
// The per-person screen deliberately does NOT reroute into the client's 1:1
// thread — the reply the trainer just read has to stay where they read it.
// There is a plain link across to the full history for when they want it.

interface GroupMessage {
  id: string
  body: string
  createdAt: string
  senderId: string
  senderName: string
  visibility: 'EVERYONE' | 'TRAINER_ONLY'
  replyToId: string | null
  isMine: boolean
  /** Photos posted with it. Ids only — the blob path never leaves the server. */
  attachments?: ChatAttachmentDto[]
}

interface GroupMeta {
  id: string
  name: string
  mode: 'BROADCAST' | 'COMMUNITY'
  archivedAt: string | null
  isTrainerSide: boolean
  joined: boolean
  canPost: boolean
  memberCount: number
  /** COMMUNITY only, trainer-side: invited and not yet accepted. */
  invitedCount: number
}

interface Participant {
  id: string
  displayName: string
  role: 'OWNER' | 'STAFF' | 'CLIENT'
}

interface ResponseRow {
  participantId: string
  displayName: string
  clientProfileId: string | null
  replied: boolean
  replyCount: number
  lastReply: string | null
  lastReplyAt: string | null
  invitedOnly: boolean
  left: boolean
}

type View =
  | { kind: 'thread' }
  | { kind: 'responses'; postId: string }
  | { kind: 'person'; postId: string; participantId: string }

export function GroupThread({
  groupId, backHref, audiences, clients, activeClientCount,
}: {
  groupId: string
  backHref: string
  /**
   * Everything the picker needs to add people later. A group could only ever
   * shrink before this — participants had a DELETE and nothing else — so a
   * class that took a late booking had no way to include them.
   * Optional: the client-side thread renders without it and shows no button.
   */
  audiences?: { classRuns: AudienceOption[]; packages: AudienceOption[]; memberships: AudienceOption[] }
  clients?: PickableClient[]
  activeClientCount?: number
}) {
  const [addingPeople, setAddingPeople] = useState(false)
  const router = useRouter()
  const [group, setGroup] = useState<GroupMeta | null>(null)
  const [messages, setMessages] = useState<GroupMessage[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [view, setView] = useState<View>({ kind: 'thread' })
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  // The same hook the 1:1 threads use, pointed at a group.
  const photos = usePhotoDrafts({ groupId })

  const load = useCallback(async () => {
    const res = await fetch(`/api/message-groups/${groupId}/messages`)
    if (!res.ok) return
    const data = await res.json()
    setGroup(data.group)
    setMessages(data.messages)
    setParticipants(data.participants ?? [])
  }, [groupId])

  useEffect(() => { void load() }, [load])

  // Live updates. Same shape as the 1:1 thread's stream — DB polling behind an
  // EventSource, so it survives serverless instance churn.
  useEffect(() => {
    const es = new EventSource(`/api/message-groups/${groupId}/stream`)
    es.addEventListener('message', e => {
      const m = JSON.parse((e as MessageEvent).data) as GroupMessage
      setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]))
    })
    es.addEventListener('reconnect', () => { es.close(); void load() })
    return () => es.close()
  }, [groupId, load])

  useEffect(() => {
    if (view.kind === 'thread') bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, view.kind])

  async function post(body: string, replyToId?: string) {
    const text = body.trim()
    const refs = photos.refs
    // A photo with no words is a post. Nothing at all is not.
    if ((!text && refs.length === 0) || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/message-groups/${groupId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, attachments: refs, ...(replyToId ? { replyToId } : {}) }),
      })
      if (res.ok) {
        const created = await res.json()
        setMessages(prev => (prev.some(x => x.id === created.id) ? prev : [...prev, created]))
        setDraft('')
        photos.clear()
      }
    } finally {
      setSending(false)
    }
  }

  async function moderate(action: 'lock' | 'unlock' | 'delete') {
    if (action === 'delete') {
      const res = await fetch(`/api/message-groups/${groupId}`, { method: 'DELETE' })
      if (res.ok) { router.push(backHref); router.refresh() }
      return
    }
    await fetch(`/api/message-groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: action === 'lock' }),
    })
    setMenuOpen(false)
    void load()
    router.refresh()
  }

  async function deleteMessage(id: string) {
    const res = await fetch(`/api/message-groups/${groupId}/messages/${id}`, { method: 'DELETE' })
    if (res.ok) setMessages(prev => prev.filter(m => m.id !== id))
  }

  if (!group) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading…</div>
  }

  if (view.kind === 'responses') {
    return (
      <ResponsesView
        groupId={groupId}
        postId={view.postId}
        onBack={() => setView({ kind: 'thread' })}
        onPerson={participantId => setView({ kind: 'person', postId: view.postId, participantId })}
      />
    )
  }
  if (view.kind === 'person') {
    return (
      <PersonView
        groupId={groupId}
        postId={view.postId}
        participantId={view.participantId}
        onBack={() => setView({ kind: 'responses', postId: view.postId })}
      />
    )
  }

  // Replies never sit inline in the trainer's group thread — in BROADCAST they
  // are private to us and would read as if the whole group could see them.
  const posts = messages.filter(m => !m.replyToId || group.mode === 'COMMUNITY')

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <Header
        title={group.name}
        sub={`${group.mode === 'BROADCAST' ? 'Broadcast' : 'Community'} · ${group.memberCount} ${group.memberCount === 1 ? 'person' : 'people'}${group.archivedAt ? ' · Closed' : ''}`}
        icon={group.mode === 'BROADCAST' ? Megaphone : UsersRound}
        backHref={backHref}
        trailing={
          <button
            type="button"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Group options"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
          </button>
        }
      />

      <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-4">
        {menuOpen && (
          <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200" data-testid="group-menu">
            <MenuRow
              icon={Lock}
              label={group.archivedAt ? 'Reopen this group' : 'Close this group'}
              sub={group.archivedAt ? 'People can post again' : 'Still readable, but nobody can post'}
              onClick={() => moderate(group.archivedAt ? 'unlock' : 'lock')}
            />
            {audiences && clients && !group.archivedAt && (
              <MenuRow
                icon={UserPlus}
                label="Add people"
                sub={group.mode === 'COMMUNITY'
                  ? 'They’re invited — a community group needs each person to accept'
                  : 'They join straight away and see posts from now on'}
                onClick={() => { setMenuOpen(false); setAddingPeople(true) }}
              />
            )}
            <MenuRow
              icon={Trash2}
              label="Delete this group"
              sub="Removes it for everyone. It does not unsend — anyone already notified still has it."
              danger
              onClick={() => moderate('delete')}
            />
          </div>
        )}

        {group.mode === 'COMMUNITY' && group.invitedCount > 0 && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-900">
              {group.memberCount === 0
                ? `${group.invitedCount} ${group.invitedCount === 1 ? 'person has' : 'people have'} been invited — nobody has joined yet`
                : `${group.invitedCount} more ${group.invitedCount === 1 ? 'invitation is' : 'invitations are'} still open`}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              A community group lets members see each other, so everyone has to accept before
              they&rsquo;re in it. They&rsquo;ve had a notification.{' '}
              {group.memberCount === 0
                ? 'Until somebody accepts, anything you post here is only visible to your team.'
                : 'People who haven&rsquo;t accepted can&rsquo;t see these posts.'}
            </p>
          </div>
        )}

        {addingPeople && audiences && clients && (
          <GroupComposer
            classRuns={audiences.classRuns}
            packages={audiences.packages}
            memberships={audiences.memberships}
            clients={clients}
            activeClientCount={activeClientCount ?? clients.length}
            addToGroupId={groupId}
            onClose={() => { setAddingPeople(false); void load() }}
          />
        )}

        {group.mode === 'COMMUNITY' && participants.length > 0 && (
          <MemberStrip groupId={groupId} participants={participants} onChanged={load} />
        )}

        {posts.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">
            Nothing posted yet. Write the first message below.
          </p>
        ) : posts.map(m => (
          <Post
            key={m.id}
            message={m}
            mode={group.mode}
            replyCount={messages.filter(r => r.replyToId === m.id).length}
            memberCount={group.memberCount}
            onOpenResponses={() => setView({ kind: 'responses', postId: m.id })}
            onDelete={() => deleteMessage(m.id)}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {group.archivedAt ? (
        <p className="border-t border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">
          This group is closed. Nobody can post.
        </p>
      ) : (
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => post(draft)}
          disabled={sending}
          photos={photos}
          placeholder={`Message ${group.name}`}
        />
      )}
    </div>
  )
}

function Post({
  message, mode, replyCount, memberCount, onOpenResponses, onDelete,
}: {
  message: GroupMessage
  mode: 'BROADCAST' | 'COMMUNITY'
  replyCount: number
  memberCount: number
  onOpenResponses: () => void
  onDelete: () => void
}) {
  return (
    <div className="mb-3">
      <div className={cn(
        'rounded-xl border border-slate-200 bg-white px-4 py-3',
        message.isMine && 'border-slate-300',
      )}>
        {!message.isMine && (
          <p className="mb-1 text-xs font-medium text-slate-500">{message.senderName}</p>
        )}
        {/* A photo-only post must read as a post, not as an empty card. */}
        <ChatPhotos attachments={message.attachments ?? []} className="mb-2" />
        {message.body && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-900">{message.body}</p>
        )}
        <div className="mt-2 flex items-center gap-3">
          <span className="text-[11px] text-slate-400">
            {new Date(message.createdAt).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
          <button
            type="button"
            onClick={onDelete}
            className="text-[11px] text-slate-400 hover:text-rose-600"
          >
            Delete
          </button>
        </div>
      </div>

      {/* The way into "who said what". Only on OUR posts in a broadcast — a
          client's private reply has no responses of its own. */}
      {mode === 'BROADCAST' && message.isMine && (
        <button
          type="button"
          onClick={onOpenResponses}
          data-testid="open-responses"
          className="mt-1 flex w-full items-center gap-2 rounded-xl px-4 py-2 text-left text-xs font-medium text-blue-600 hover:bg-white"
        >
          <span className="flex-1">
            {replyCount > 0
              ? `${replyCount} of ${memberCount} replied`
              : `No replies yet — see who got it`}
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
        </button>
      )}
    </div>
  )
}

function ResponsesView({
  groupId, postId, onBack, onPerson,
}: {
  groupId: string
  postId: string
  onBack: () => void
  onPerson: (participantId: string) => void
}) {
  const [data, setData] = useState<{
    post: { body: string; createdAt: string }
    repliedCount: number
    totalCount: number
    rows: ResponseRow[]
  } | null>(null)

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/message-groups/${groupId}/responses/${postId}`)
      if (res.ok) setData(await res.json())
    })()
  }, [groupId, postId])

  if (!data) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading…</div>
  }

  // Everyone who answered, then everyone who didn't. The quiet ones are the
  // most useful rows on the screen — that is the list you chase — so they are
  // present and plainly labelled, not hidden behind a filter.
  const replied = data.rows.filter(r => r.replied)
  const silent = data.rows.filter(r => !r.replied)

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <Header
        title="Replies"
        sub={`${data.repliedCount} of ${data.totalCount} replied`}
        icon={Megaphone}
        onBack={onBack}
      />
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-4" data-testid="responses-view">
        <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-900">{data.post.body}</p>
          <p className="mt-2 text-[11px] text-slate-400">
            {new Date(data.post.createdAt).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {replied.length > 0 && (
          <>
            <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-400">Replied</p>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
              {replied.map(r => (
                <PersonRow key={r.participantId} row={r} onClick={() => onPerson(r.participantId)} />
              ))}
            </div>
          </>
        )}

        {silent.length > 0 && (
          <>
            <p className="mb-2 mt-5 px-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              No reply yet
            </p>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
              {silent.map(r => (
                <PersonRow key={r.participantId} row={r} onClick={() => onPerson(r.participantId)} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PersonRow({ row, onClick }: { row: ResponseRow; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-slate-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{row.displayName}</span>
        {row.lastReply ? (
          <span className="mt-0.5 block truncate text-[13px] text-slate-600">{row.lastReply}</span>
        ) : (
          <span className="mt-0.5 block text-[13px] text-slate-400">
            {row.left ? 'No longer in this group' : row.invitedOnly ? 'Hasn’t joined yet' : 'No reply'}
          </span>
        )}
      </span>
      {row.replyCount > 1 && (
        <span className="mt-0.5 flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-600">
          {row.replyCount}
        </span>
      )}
      <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
    </button>
  )
}

function PersonView({
  groupId, postId, participantId, onBack,
}: {
  groupId: string
  postId: string
  participantId: string
  onBack: () => void
}) {
  const [data, setData] = useState<{
    person: { displayName: string; clientProfileId: string | null; left: boolean }
    messages: {
      id: string
      body: string
      createdAt: string
      isMine: boolean
      fromPerson: boolean
      attachments?: ChatAttachmentDto[]
    }[]
  } | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/message-groups/${groupId}/responses/${postId}?person=${participantId}`)
    if (res.ok) setData(await res.json())
  }, [groupId, postId, participantId])

  useEffect(() => { void load() }, [load])

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      // Posts as a normal private reply under THIS broadcast, so the exchange
      // stays where the trainer read it instead of being scattered into the
      // 1:1 thread.
      const res = await fetch(`/api/message-groups/${groupId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, replyToId: postId }),
      })
      if (res.ok) { setDraft(''); await load() }
    } finally {
      setSending(false)
    }
  }

  if (!data) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading…</div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <Header
        title={data.person.displayName}
        sub="Replies to this message"
        icon={Megaphone}
        onBack={onBack}
        trailing={data.person.clientProfileId ? (
          <Link
            href={`/messages?client=${data.person.clientProfileId}`}
            className="flex-shrink-0 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            Full history
          </Link>
        ) : undefined}
      />
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-4" data-testid="person-view">
        {data.messages.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">
            They haven’t replied to this yet. You can write to them below.
          </p>
        ) : data.messages.map(m => (
          <div
            key={m.id}
            className={cn(
              'mb-2 max-w-[85%] rounded-xl px-4 py-2.5',
              m.fromPerson ? 'border border-slate-200 bg-white' : 'ml-auto bg-slate-900',
            )}
          >
            {/* A client's reply here can be a photo of the harness with no
                words at all. */}
            <ChatPhotos attachments={m.attachments ?? []} className="mb-1.5" />
            {m.body && (
              <p className={cn(
                'whitespace-pre-wrap text-sm leading-relaxed',
                m.fromPerson ? 'text-slate-900' : 'text-white',
              )}>
                {m.body}
              </p>
            )}
            <p className={cn('mt-1 text-[11px]', m.fromPerson ? 'text-slate-400' : 'text-slate-400')}>
              {new Date(m.createdAt).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        ))}
      </div>
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={send}
        disabled={sending}
        placeholder={`Reply to ${data.person.displayName}`}
      />
    </div>
  )
}

function MemberStrip({
  groupId, participants, onChanged,
}: {
  groupId: string
  participants: Participant[]
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const clients = participants.filter(p => p.role === 'CLIENT')

  async function remove(participantId: string) {
    const res = await fetch(`/api/message-groups/${groupId}/participants/${participantId}`, { method: 'DELETE' })
    if (res.ok) onChanged()
  }

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-50"
      >
        <UsersRound className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">
          {clients.length} {clients.length === 1 ? 'member' : 'members'}
        </span>
        <ChevronRight className={cn('h-4 w-4 flex-shrink-0 text-slate-400 transition-transform', open && 'rotate-90')} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="border-t border-slate-200 [&>*+*]:border-t [&>*+*]:border-slate-100">
          {clients.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              {/* Display name only. The trainer knows who these people are;
                  the payload still carries nothing else, so there is nothing
                  here that could leak into a client-facing view by accident. */}
              <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{p.displayName}</span>
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label={`Remove ${p.displayName}`}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-600"
              >
                <UserMinus className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Header({
  title, sub, icon: Icon, backHref, onBack, trailing,
}: {
  title: string
  sub: string
  icon: typeof Megaphone
  backHref?: string
  onBack?: () => void
  trailing?: React.ReactNode
}) {
  const router = useRouter()
  return (
    <div
      className="pm-thread-header sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white px-4"
    >
      <button
        type="button"
        onClick={() => (onBack ? onBack() : backHref && router.push(backHref))}
        aria-label="Back"
        className={cn(
          '-ml-1.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700',
          // On desktop the list pane is always visible, so a back button that
          // only leaves the thread is noise — but the in-thread drill-downs
          // still need one.
          backHref && 'md:hidden',
        )}
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
      </button>
      <Icon className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
        <p className="truncate text-xs text-slate-500">{sub}</p>
      </div>
      {trailing}
    </div>
  )
}

function MenuRow({
  icon: Icon, label, sub, onClick, danger,
}: {
  icon: typeof Lock
  label: string
  sub: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 px-4 py-3.5 text-left active:bg-slate-50"
    >
      <Icon className={cn('mt-0.5 h-[18px] w-[18px] flex-shrink-0', danger ? 'text-rose-600' : 'text-slate-700')} strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm font-medium', danger ? 'text-rose-600' : 'text-slate-900')}>{label}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-slate-500">{sub}</span>
      </span>
    </button>
  )
}

function Composer({
  value, onChange, onSend, disabled, placeholder, photos,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  disabled: boolean
  placeholder: string
  /** Omitted on the per-person reply box, which is text-only for now. */
  photos?: PhotoDraftsApi
}) {
  const busy = !!photos?.busy
  return (
    <div className="pm-thread-composer border-t border-slate-200 bg-white px-4">
      {photos && <PhotoDraftStrip photos={photos} />}
      <div className="flex items-end gap-2">
      {photos && (
        <PhotoAttachButton
          photos={photos}
          disabled={disabled}
          accentClassName="hover:border-slate-400 hover:text-slate-700"
        />
      )}
      <textarea
        value={value}
        onChange={e => onChange(e.target.value.slice(0, 2000))}
        rows={1}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid="group-composer-input"
        className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
      />
      <button
        type="button"
        onClick={onSend}
        // Off while a photo is still uploading — pressing it then would post
        // the message without the picture.
        disabled={disabled || busy || (!value.trim() && !photos?.hasPhotos)}
        aria-label="Send"
        data-testid="group-post"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
      >
        <Send className="h-4 w-4" strokeWidth={1.75} />
      </button>
      </div>
    </div>
  )
}
