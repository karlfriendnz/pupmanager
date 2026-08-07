'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageCircle, ArrowLeft, Check, CheckCheck, ChevronRight, Megaphone, Plus, UsersRound } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ClientAvatar } from '@/components/shared/client-avatar'
import { PhoneRowList } from '@/components/shared/flat-list'
import { MessageThread } from './[clientId]/message-thread'
import { SetPageImmersive } from '@/components/shared/page-title'
import { GroupComposer, type AudienceOption, type PickableClient } from './group-composer'
import type { ThreadProposalDto } from '@/lib/thread-proposal'
import { GroupThread } from './group-thread'

export interface ClientRow {
  id: string
  status: string
  displayName: string
  dogName: string | null
  dogPhotoUrl: string | null
  unread: number
  lastMessage: {
    body: string
    createdAt: string
    senderName: string | null
    /** The last word was ours (the business), not the client's. */
    outgoing: boolean
    /** When the recipient opened it. Only meaningful on an outgoing message. */
    readAt: string | null
  } | null
}

export interface ThreadMessage {
  id: string
  body: string
  senderId: string
  createdAt: string
  readAt: string | null
  sender: { name: string | null; email: string }
  /** Set only when this message IS a counter-offer on a booking request. */
  proposal?: ThreadProposalDto | null
}

export interface SelectedClient {
  id: string
  displayName: string
  dogName: string | null
  dogPhotoUrl: string | null
}

export interface GroupRow {
  id: string
  name: string
  mode: 'BROADCAST' | 'COMMUNITY'
  archived: boolean
  memberCount: number
  /** Invited to a COMMUNITY group but not yet accepted. */
  invitedCount: number
  unread: number
  /** When the group was made — how an empty one earns its place in the list. */
  createdAt: string
  lastMessage: { body: string; createdAt: string; senderName: string } | null
}

interface Props {
  activeClients: ClientRow[]
  inactiveClients: ClientRow[]
  activeUnread: number
  inactiveUnread: number
  groups: GroupRow[]
  tab: 'active' | 'inactive' | 'groups'
  selectedClient: SelectedClient | null
  selectedGroupId: string | null
  threadMessages: ThreadMessage[]
  currentUserId: string
  audiences: { classRuns: AudienceOption[]; packages: AudienceOption[]; memberships: AudienceOption[] }
  pickableClients: PickableClient[]
  activeClientCount: number
}

/**
 * Merge client threads and groups into ONE list ordered by activity.
 *
 * The screen used to enumerate clients, not conversations — a group has
 * nothing to hang off that. Keeping the existing rule (anything unread floats
 * to the top, then most recent first) means a group behaves exactly like a
 * thread, which is the whole point of making it one.
 */
type ListEntry =
  | { kind: 'client'; sort: number; client: ClientRow }
  | { kind: 'group'; sort: number; group: GroupRow }

/**
 * "New group" — one row, two homes.
 *
 * Top of the Groups tab, foot of the others. Same markup either way so the two
 * cannot drift apart; only the border moves, because a row at the top of a list
 * wants its divider underneath it and a row at the foot wants it above.
 */
/**
 * "New group" — top of the Groups tab, and nowhere else.
 *
 * It used to sit at the foot of every tab. Active and Inactive are lists of
 * CLIENT threads, so a button there offers a different kind of thing from the
 * list it is attached to; the Groups tab is one tap away for anyone who wants
 * one. A button rather than a row, because in a list of conversations a row
 * reads as another conversation.
 */
function NewGroupRow({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex-shrink-0 border-b border-slate-100 bg-white px-3 py-3">
      <button
        type="button"
        onClick={onClick}
        data-testid="open-group-composer"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
      >
        <Plus className="h-4 w-4 flex-shrink-0" strokeWidth={2.25} />
        New group
      </button>
    </div>
  )
}

export function mergeThreadsAndGroups(clients: ClientRow[], groups: GroupRow[]): ListEntry[] {
  // Most recent activity first, and ONLY that.
  //
  // Unread used to add half of MAX_SAFE_INTEGER to the sort key, which floated
  // every unread thread above every read one whatever the dates said. It reads
  // as a bug rather than a feature: the list stops being a timeline, a message
  // from last week sits above one from this morning, and opening something
  // makes it jump down the list under the trainer's cursor. Unread is already
  // shown — bold text and a badge — so it does not also need to reorder the
  // world to be noticed.
  //
  // A group with no posts falls back to WHEN IT WAS MADE, not to zero. Sorting
  // an empty group to the bottom sent a group the trainer created five seconds
  // ago to the foot of the list, under conversations from months back — the one
  // moment they are certain to be looking for it. Creating a thing is activity.
  //
  // A client thread has no such fallback and still sorts to 0: it exists
  // because the client does, not because anybody did anything, so "never talked
  // to" belongs at the bottom.
  const entries: ListEntry[] = [
    ...clients.map(c => ({
      kind: 'client' as const,
      client: c,
      sort: c.lastMessage ? Date.parse(c.lastMessage.createdAt) : 0,
    })),
    ...groups.map(g => ({
      kind: 'group' as const,
      group: g,
      sort: Date.parse(g.lastMessage?.createdAt ?? g.createdAt),
    })),
  ]
  return entries.sort((a, b) => b.sort - a.sort)
}

// Delivery state for a message WE sent. `Message.readAt` is stamped when the
// other party opens the thread, so on an outgoing message it means exactly
// "the client has read this" — nothing is inferred or faked. There is no
// separate delivery receipt in the schema (no per-device ack), so a message
// that exists but hasn't been read reads as "Sent", not "Delivered".
function DeliveryTick({ readAt, className }: { readAt: string | null; className?: string }) {
  const read = !!readAt
  const label = read ? 'Read by the client' : 'Sent — not read yet'
  return (
    <span
      role="img"
      aria-label={label}
      title={read ? `Read ${new Date(readAt!).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : label}
      data-read={read ? 'true' : 'false'}
      data-testid="delivery-tick"
      className={cn('inline-flex items-center gap-1 text-[11px]', read ? 'text-blue-600' : 'text-slate-400', className)}
    >
      {read
        ? <CheckCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
        : <Check className="h-3.5 w-3.5" strokeWidth={1.75} />}
    </span>
  )
}

// Two-pane messages layout. Desktop: list on the left (320px), thread on
// the right. Mobile: stacked — when no thread is selected the list fills
// the screen, when one is selected the thread fills the screen and a
// back button returns to the list.
//
// URL contract: `?tab=active|inactive` controls the tab filter,
// `?client=<id>` selects a thread. Server fetches state from the URL so
// every load is shareable / refreshable.
export function MessagesView({
  activeClients,
  inactiveClients,
  activeUnread,
  inactiveUnread,
  groups,
  tab,
  selectedClient,
  selectedGroupId,
  threadMessages,
  currentUserId,
  audiences,
  pickableClients,
  activeClientCount,
}: Props) {
  const router = useRouter()
  const [composing, setComposing] = useState(false)
  // Groups belong to the business, not to a client's active/inactive status,
  // so they live in the Active tab beside the live conversations.
  const visible = tab === 'inactive'
    ? mergeThreadsAndGroups(inactiveClients, [])
    : tab === 'groups'
      // Groups only. They stay in Active as well — this narrows the view, it
      // does not move them somewhere else.
      ? mergeThreadsAndGroups([], groups)
      : mergeThreadsAndGroups(activeClients, groups)
  const groupUnread = groups.reduce((n, g) => n + g.unread, 0)

  function hrefFor({ clientId, groupId, nextTab }: { clientId?: string; groupId?: string; nextTab?: 'active' | 'inactive' | 'groups' } = {}) {
    const params = new URLSearchParams()
    const t = nextTab ?? tab
    if (t !== 'active') params.set('tab', t)
    if (clientId) params.set('client', clientId)
    if (groupId) params.set('group', groupId)
    const qs = params.toString()
    return qs ? `/messages?${qs}` : '/messages'
  }

  // Mobile (<md): swap which pane is visible based on whether a thread
  // is selected. Desktop keeps both visible side-by-side.
  // With a thread open the phone shows only the thread, and its composer sits
  // at the bottom of the screen — five nav tabs beneath that read as clutter
  // and made it unclear what you were looking at. Desktop is unaffected: the
  // tab bar is md:hidden, and both panes stay side by side there.
  const rightPaneOpen = !!selectedClient || !!selectedGroupId
  const listVisibility = rightPaneOpen ? 'hidden md:flex' : 'flex'
  const threadVisibility = rightPaneOpen ? 'flex' : 'hidden md:flex'

  return (
    // -mx negates the page's horizontal padding so the panes go flush
    // to main's edges. No top margin — PageHeader has its own bottom
    // border, so the two-pane content sits cleanly below it.
    <div className="flex flex-1 min-h-0 -mx-4 md:-mx-8">
      {/* Hides the phone's bottom tab bar while a thread is open. */}
      <SetPageImmersive value={rightPaneOpen} />
      {/* ── Thread list (left pane) ─────────────────────────────────────── */}
      <aside
        className={cn(
          // `min-h-0` is critical — without it the aside's intrinsic
          // height defaults to its content, which means the inner
          // overflow-y-auto can't take effect and the list grows past
          // the viewport instead of scrolling.
          'flex-col w-full md:w-80 md:flex-shrink-0 md:border-r border-slate-100 bg-white min-w-0 min-h-0',
          listVisibility,
        )}
      >
        {/* Tab strip — sticky at the top of the list pane so the Active /
            Inactive controls stay visible while the list scrolls. */}
        <div className="sticky top-0 z-10 flex gap-1 border-b border-slate-100 bg-white p-2">
          {([
            // Groups live in Active, so they count there too — otherwise the
            // tab says 12 and the list shows 15.
            { key: 'active',   label: 'Active',   count: activeClients.length + groups.length, unread: activeUnread + groupUnread },
            { key: 'groups',   label: 'Groups',   count: groups.length,                        unread: groupUnread },
            { key: 'inactive', label: 'Inactive', count: inactiveClients.length,               unread: inactiveUnread },
          ] as const).map(t => {
            const active = tab === t.key
            return (
              <Link
                key={t.key}
                href={hrefFor({ nextTab: t.key })}
                className={cn(
                  'flex-1 px-3 py-2 rounded-lg text-sm font-medium text-center transition-colors',
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50',
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  {t.label}
                  <span className={cn(
                    'inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] tabular-nums',
                    active ? 'bg-white text-blue-700' : 'bg-slate-100 text-slate-500',
                  )}>
                    {t.count}
                  </span>
                  {t.unread > 0 && (
                    <span
                      aria-label={`${t.unread} unread`}
                      className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-semibold tabular-nums"
                    >
                      {t.unread > 9 ? '9+' : t.unread}
                    </span>
                  )}
                </span>
              </Link>
            )
          })}
        </div>

        {/* List body */}
        <div className="flex-1 overflow-y-auto p-2">
          {tab === 'groups' && <NewGroupRow onClick={() => setComposing(true)} />}

          {visible.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">
                {tab === 'groups' ? 'No groups yet'
                  : tab === 'inactive' ? 'No inactive clients'
                  : 'No active clients yet'}
              </p>
              <p className="text-sm mt-1">
                {tab === 'groups' ? 'Message a class, a package or a handful of people at once.'
                  : tab === 'inactive' ? 'Inactive clients with threads show up here.'
                  : 'Invite a client to start messaging.'}
              </p>
            </div>
          ) : (
            <PhoneRowList className="md:flex md:flex-col md:gap-1.5">
              {visible.map(entry => {
                if (entry.kind === 'group') {
                  const g = entry.group
                  const isSelected = selectedGroupId === g.id
                  const Icon = g.mode === 'BROADCAST' ? Megaphone : UsersRound
                  return (
                    <Link key={g.id} href={hrefFor({ groupId: g.id })} scroll={false}>
                      <Card
                        data-testid="group-row"
                        className={cn(
                          'transition-colors cursor-pointer',
                          'rounded-none border-0 shadow-none md:rounded-2xl md:border md:shadow-sm',
                          isSelected ? 'border-blue-300 bg-blue-50/50'
                            : g.unread > 0 ? 'border-blue-200 bg-blue-50/30'
                            : 'hover:border-blue-200 hover:bg-slate-50',
                        )}
                      >
                        <CardBody className="px-4 py-2.5 md:pt-3 md:pb-3">
                          <div className="flex items-center gap-3">
                            {/* A plain line icon, not a tinted tile — the
                                clearest tell of a machine-made screen. */}
                            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-slate-200">
                              <Icon className="h-[18px] w-[18px] text-slate-700" strokeWidth={1.75} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className={cn(
                                  'truncate text-sm',
                                  g.unread > 0 ? 'font-bold text-slate-900' : 'font-semibold text-slate-900',
                                )}>
                                  {g.name}
                                </p>
                                {g.lastMessage && (
                                  <span className={cn(
                                    'flex-shrink-0 text-xs tabular-nums',
                                    g.unread > 0 ? 'font-semibold text-rose-600' : 'text-slate-400',
                                  )}>
                                    {new Date(g.lastMessage.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5">
                                {g.lastMessage ? (
                                  <p className={cn(
                                    'min-w-0 flex-1 truncate text-xs',
                                    g.unread > 0 ? 'font-medium text-slate-700' : 'text-slate-500',
                                  )}>
                                    {g.lastMessage.senderName}: {g.lastMessage.body}
                                  </p>
                                ) : (
                                  <p className="min-w-0 flex-1 truncate text-xs italic text-slate-400">
                                    {g.mode === 'BROADCAST' ? 'Broadcast' : 'Community'} · {g.memberCount} {g.memberCount === 1 ? 'person' : 'people'}
                                    {g.invitedCount > 0 ? ` · ${g.invitedCount} not joined` : ''}
                                  </p>
                                )}
                                {g.unread > 0 && (
                                  <span
                                    data-testid="group-unread"
                                    aria-label={`${g.unread} unread`}
                                    className="inline-flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold tabular-nums text-white"
                                  >
                                    {g.unread > 9 ? '9+' : g.unread}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </CardBody>
                      </Card>
                    </Link>
                  )
                }
                const client = entry.client
                const lastMsg = client.lastMessage
                const isSelected = selectedClient?.id === client.id
                return (
                  <Link key={client.id} href={hrefFor({ clientId: client.id })} scroll={false}>
                    <Card
                      className={cn(
                        'transition-colors cursor-pointer',
                        // Phone: a row in the shared block — no card of its own.
                        'rounded-none border-0 shadow-none md:rounded-2xl md:border md:shadow-sm',
                        isSelected ? 'border-blue-300 bg-blue-50/50' : client.unread > 0 ? 'border-blue-200 bg-blue-50/30' : 'hover:border-blue-200 hover:bg-slate-50',
                      )}
                    >
                      <CardBody className="px-4 py-2.5 md:pt-3 md:pb-3">
                        <div className="flex items-center gap-3">
                          <ClientAvatar size="lg" name={client.displayName} dogPhotoUrl={client.dogPhotoUrl} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className={cn(
                                'text-sm truncate',
                                client.unread > 0 ? 'font-bold text-slate-900' : 'font-semibold text-slate-900',
                              )}>
                                {client.displayName}{client.dogName ? ` · ${client.dogName}` : ''}
                              </p>
                              {lastMsg && (
                                <span className={cn(
                                  'text-xs flex-shrink-0 tabular-nums',
                                  client.unread > 0 ? 'text-rose-600 font-semibold' : 'text-slate-400',
                                )}>
                                  {new Date(lastMsg.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                                </span>
                              )}
                            </div>
                            {/* Second line: who said what last, with the two
                                things a trainer scans this list for — has the
                                client written something I haven't read, and did
                                my last message land. The unread badge sits at
                                the trailing edge (one per row, in a column) —
                                it used to hang off the avatar, where it read as
                                part of the photo rather than as a count. */}
                            <div className="mt-0.5 flex items-center gap-1.5">
                              {lastMsg?.outgoing && (
                                <DeliveryTick readAt={lastMsg.readAt} className="flex-shrink-0" />
                              )}
                              {lastMsg ? (
                                <p className={cn(
                                  'min-w-0 flex-1 truncate text-xs',
                                  client.unread > 0 ? 'text-slate-700 font-medium' : 'text-slate-500',
                                )}>
                                  {lastMsg.senderName ?? 'Unknown'}: {lastMsg.body}
                                </p>
                              ) : (
                                <p className="min-w-0 flex-1 text-xs text-slate-400 italic">No messages yet</p>
                              )}
                              {client.unread > 0 && (
                                <span
                                  data-testid="thread-unread"
                                  aria-label={`${client.unread} unread`}
                                  className="inline-flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white tabular-nums"
                                >
                                  {client.unread > 9 ? '9+' : client.unread}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                  </Link>
                )
              })}
            </PhoneRowList>
          )}
        </div>


      </aside>

      {composing && (
        <GroupComposer
          classRuns={audiences.classRuns}
          packages={audiences.packages}
          memberships={audiences.memberships}
          clients={pickableClients}
          activeClientCount={activeClientCount}
          onClose={() => setComposing(false)}
        />
      )}

      {/* ── Thread (right pane) ────────────────────────────────────────── */}
      <section className={cn('flex-1 flex-col min-w-0 min-h-0 bg-slate-50', threadVisibility)}>
        {selectedGroupId ? (
          <GroupThread
            key={selectedGroupId}
            groupId={selectedGroupId}
            backHref={hrefFor()}
            audiences={audiences}
            clients={pickableClients}
            activeClientCount={activeClientCount}
          />
        ) : selectedClient ? (
          <>
            <div className="pm-thread-header sticky top-0 z-10 flex items-center gap-3 px-4 border-b border-slate-100 bg-white">
              {/* Mobile back → clears the ?client param to return to the
                  list pane. Hidden on desktop where the list is always
                  visible alongside. router.push is preferred over Link
                  because the link target depends on the current tab. */}
              <button
                type="button"
                onClick={() => router.push(hrefFor())}
                aria-label="Back to messages list"
                className="md:hidden -ml-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 flex-shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <ClientAvatar size="md" name={selectedClient.displayName} dogPhotoUrl={selectedClient.dogPhotoUrl} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900 text-sm truncate">{selectedClient.displayName}</p>
                {selectedClient.dogName && (
                  <p className="text-xs text-slate-500 truncate">{selectedClient.dogName}</p>
                )}
              </div>
              <Link
                href={`/clients/${selectedClient.id}`}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline flex-shrink-0"
              >
                View profile
              </Link>
            </div>

            {/* Key on clientId so the thread component fully resets its
                local state (messages array, draft input) when the user
                jumps from one thread to another. */}
            <MessageThread
              key={selectedClient.id}
              clientId={selectedClient.id}
              currentUserId={currentUserId}
              initialMessages={threadMessages}
            />
          </>
        ) : (
          <div className="hidden md:flex flex-1 items-center justify-center text-slate-400">
            <div className="text-center">
              <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Pick a conversation</p>
              <p className="text-sm mt-1">Choose a client from the list to read their messages.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
