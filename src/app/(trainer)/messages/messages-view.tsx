'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageCircle, ArrowLeft } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { MessageThread } from './[clientId]/message-thread'

export interface ClientRow {
  id: string
  status: string
  displayName: string
  dogName: string | null
  unread: number
  lastMessage: {
    body: string
    createdAt: string
    senderName: string | null
  } | null
}

export interface ThreadMessage {
  id: string
  body: string
  senderId: string
  createdAt: string
  sender: { name: string | null; email: string }
}

export interface SelectedClient {
  id: string
  displayName: string
  dogName: string | null
}

interface Props {
  activeClients: ClientRow[]
  inactiveClients: ClientRow[]
  activeUnread: number
  inactiveUnread: number
  tab: 'active' | 'inactive'
  selectedClient: SelectedClient | null
  threadMessages: ThreadMessage[]
  currentUserId: string
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
  tab,
  selectedClient,
  threadMessages,
  currentUserId,
}: Props) {
  const router = useRouter()
  const visible = tab === 'inactive' ? inactiveClients : activeClients

  function hrefFor({ clientId, nextTab }: { clientId?: string; nextTab?: 'active' | 'inactive' } = {}) {
    const params = new URLSearchParams()
    const t = nextTab ?? tab
    if (t === 'inactive') params.set('tab', 'inactive')
    if (clientId) params.set('client', clientId)
    const qs = params.toString()
    return qs ? `/messages?${qs}` : '/messages'
  }

  // Mobile (<md): swap which pane is visible based on whether a thread
  // is selected. Desktop keeps both visible side-by-side.
  const listVisibility = selectedClient ? 'hidden md:flex' : 'flex'
  const threadVisibility = selectedClient ? 'flex' : 'hidden md:flex'

  return (
    <div className="flex flex-1 min-h-0 -mx-4 md:-mx-8 -mb-20 md:mb-0 border-t border-slate-100">
      {/* ── Thread list (left pane) ─────────────────────────────────────── */}
      <aside
        className={cn(
          'flex-col w-full md:w-80 md:flex-shrink-0 md:border-r border-slate-100 bg-white min-w-0',
          listVisibility,
        )}
      >
        {/* Tab strip */}
        <div className="flex gap-1 border-b border-slate-200 px-2 pt-2">
          {([
            { key: 'active',   label: 'Active',   count: activeClients.length,   unread: activeUnread },
            { key: 'inactive', label: 'Inactive', count: inactiveClients.length, unread: inactiveUnread },
          ] as const).map(t => {
            const active = tab === t.key
            return (
              <Link
                key={t.key}
                href={hrefFor({ nextTab: t.key })}
                className={cn(
                  'flex-1 px-3 py-2 text-sm font-medium text-center -mb-px border-b-2 transition-colors',
                  active ? 'text-blue-700 border-blue-600' : 'text-slate-500 border-transparent hover:text-slate-700',
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  {t.label}
                  <span className={cn(
                    'inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] tabular-nums',
                    active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500',
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
          {visible.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">
                {tab === 'inactive' ? 'No inactive clients' : 'No active clients yet'}
              </p>
              <p className="text-sm mt-1">
                {tab === 'inactive' ? 'Inactive clients with threads show up here.' : 'Invite a client to start messaging.'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {visible.map(client => {
                const lastMsg = client.lastMessage
                const isSelected = selectedClient?.id === client.id
                return (
                  <Link key={client.id} href={hrefFor({ clientId: client.id })} scroll={false}>
                    <Card
                      className={cn(
                        'transition-colors cursor-pointer',
                        isSelected ? 'border-blue-300 bg-blue-50/50' : client.unread > 0 ? 'border-blue-200 bg-blue-50/30' : 'hover:border-blue-200 hover:bg-slate-50',
                      )}
                    >
                      <CardBody className="pt-3 pb-3">
                        <div className="flex items-center gap-3">
                          <div className="relative h-10 w-10 rounded-full bg-blue-100 text-blue-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
                            {client.displayName[0].toUpperCase()}
                            {client.unread > 0 && (
                              <span
                                aria-label={`${client.unread} unread`}
                                className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white tabular-nums ring-2 ring-white"
                              >
                                {client.unread > 9 ? '9+' : client.unread}
                              </span>
                            )}
                          </div>
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
                            {lastMsg ? (
                              <p className={cn(
                                'text-xs truncate mt-0.5',
                                client.unread > 0 ? 'text-slate-700 font-medium' : 'text-slate-500',
                              )}>
                                {lastMsg.senderName ?? 'Unknown'}: {lastMsg.body}
                              </p>
                            ) : (
                              <p className="text-xs text-slate-400 mt-0.5 italic">No messages yet</p>
                            )}
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </aside>

      {/* ── Thread (right pane) ────────────────────────────────────────── */}
      <section className={cn('flex-1 flex-col min-w-0 min-h-0 bg-slate-50', threadVisibility)}>
        {selectedClient ? (
          <>
            <div
              className="sticky top-0 z-10 flex items-center gap-3 px-4 border-b border-slate-100 bg-white"
              style={{
                paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.625rem)',
                paddingBottom: '0.625rem',
                marginTop: 'calc(min(env(safe-area-inset-top, 0px), 1rem) * -1)',
              }}
            >
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
              <div className="h-9 w-9 rounded-full bg-blue-100 text-blue-700 font-bold text-sm flex items-center justify-center flex-shrink-0">
                {selectedClient.displayName[0].toUpperCase()}
              </div>
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
