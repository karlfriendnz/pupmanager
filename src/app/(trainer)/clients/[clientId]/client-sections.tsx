'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle, Calendar, Clock, Mail, MailOpen, MapPin, MessageSquare,
  MousePointerClick, Pencil, Send, Trash2, Video, X,
} from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { OfferingTabs } from '@/components/shared/offering-tabs'
import { Button } from '@/components/ui/button'
import { CurrencyGlyph } from '@/components/currency-glyph'
import { RichText } from '@/components/shared/rich-text'
import { SessionFormReport } from '@/components/session-form-report'
import { isRichTextEmpty } from '@/lib/rich-text'
import { cn, displayEmail, formatDate, formatSessionTitle } from '@/lib/utils'
import { DogGalleryManager } from './dog-gallery-manager'
import { StatusToggle } from './status-toggle'
import {
  STATUS_OPTIONS,
  type ClientContact, type CommItem, type CustomField, type Dog,
  type SessionStatus, type TrainingSession,
} from './client-profile-types'

/**
 * The four sections of a client that had no component of their own.
 *
 * Every section of a client's record is a PAGE now, not a tab (Karl,
 * 2026-08-06: "these need to open new pages there is no way people will see the
 * change at the bottom" — tapping a tab swapped content below the fold, so on a
 * phone nothing appeared to happen). Notes, the training log, invoices and
 * achievements already had their own components; sessions, dogs, comms and
 * details were 350 lines of JSX inside the tab switch. They are here, unchanged
 * in behaviour, so the section route can render one of them on its own.
 */

// ─── Sessions ────────────────────────────────────────────────────────────────

/**
 * The client's sessions, their delete confirm, and the detail modal that
 * `?sessionId=` deep-links into.
 *
 * All three moved together because they share one piece of state: the list.
 * Deleting from the list has to update it, and the modal edits a row's status
 * in place. Splitting them would have meant lifting that state into the page.
 */
export function ClientSessionsSection({
  sessions: initialSessions,
}: {
  sessions: TrainingSession[]
}) {
  const [sessions, setSessions] = useState(initialSessions)
  const [activeSession, setActiveSession] = useState<TrainingSession | null>(null)
  const [savingStatus, setSavingStatus] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const searchParams = useSearchParams()
  const router = useRouter()

  // Keep in step with the server after a router.refresh() (assigning a package,
  // deleting from elsewhere).
  useEffect(() => { setSessions(initialSessions) }, [initialSessions])

  // ?sessionId= opens that session's modal. The link is in push notifications
  // and in emails, so it has to keep working now this is its own route.
  useEffect(() => {
    const sessionId = searchParams.get('sessionId')
    if (!sessionId) return
    const found = sessions.find(s => s.id === sessionId) ?? null
    if (found) setActiveSession(found)
  }, [searchParams, sessions])

  const closeModal = useCallback(() => {
    setActiveSession(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('sessionId')
    router.replace(url.pathname + (url.search || ''), { scroll: false })
  }, [router])

  async function handleStatusChange(sessionId: string, status: SessionStatus) {
    setSavingStatus(true)
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status } : s))
    setActiveSession(prev => prev ? { ...prev, status } : null)
    try {
      await fetch(`/api/schedule/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
    } finally {
      setSavingStatus(false)
    }
  }

  async function handleDelete(ids: string[]) {
    setDeleting(true)
    const results = await Promise.allSettled(
      ids.map(id => fetch(`/api/schedule/${id}`, { method: 'DELETE' }))
    )
    const successful = ids.filter((_, i) => {
      const r = results[i]
      return r.status === 'fulfilled' && r.value.ok
    })
    setSessions(prev => prev.filter(s => !successful.includes(s.id)))
    setDeleting(false)
    setConfirmDelete(null)
  }

  return (
    <>
      <SessionsPanel sessions={sessions} onConfirmDelete={(id) => setConfirmDelete({ ids: [id] })} />

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !deleting && setConfirmDelete(null)}
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div
            className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 flex-shrink-0">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-900">
                    Delete {confirmDelete.ids.length === 1 ? 'this session' : `${confirmDelete.ids.length} sessions`}?
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    This can&apos;t be undone. Any tasks attached to {confirmDelete.ids.length === 1 ? 'it' : 'them'} will be unlinked.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)} disabled={deleting}>
                  Cancel
                </Button>
                <Button variant="danger" size="sm" loading={deleting} onClick={() => handleDelete(confirmDelete.ids)}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeSession && (() => {
        const s = activeSession
        const d = new Date(s.scheduledAt)
        const isPast = d < new Date()
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={closeModal}>
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
            <div
              className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className={`px-6 py-5 ${s.sessionType === 'VIRTUAL' ? 'bg-purple-50 border-b border-purple-100' : 'bg-blue-50 border-b border-blue-100'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className={`text-xs font-semibold uppercase tracking-wide ${s.sessionType === 'VIRTUAL' ? 'text-purple-500' : 'text-blue-500'}`}>
                      {s.sessionType === 'VIRTUAL' ? '💻 Virtual session' : '📍 In-person session'}
                    </span>
                    <h2 className="text-lg font-bold text-slate-900 mt-0.5">{s.title}</h2>
                    {isPast && (
                      <span className="inline-block mt-1 text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Past</span>
                    )}
                  </div>
                  <button onClick={closeModal} className="p-1 text-slate-400 hover:text-slate-600 flex-shrink-0">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="px-6 py-5 flex flex-col gap-4">
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Status</p>
                  <div className="flex gap-2 flex-wrap">
                    {STATUS_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        disabled={savingStatus}
                        onClick={() => handleStatusChange(s.id, opt.value)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-all ${
                          s.status === opt.value
                            ? `${opt.colour} ring-2 ring-offset-1 ring-current`
                            : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                        } disabled:opacity-50`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Calendar className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {d.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                    <p className="text-sm text-slate-500">
                      {d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-slate-400 flex-shrink-0" />
                  <p className="text-sm text-slate-700">{s.durationMins} minutes</p>
                </div>

                {s.location && (
                  <div className="flex items-start gap-3">
                    <MapPin className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-slate-700">{s.location}</p>
                  </div>
                )}

                {s.virtualLink && (
                  <div className="flex items-center gap-3">
                    <Video className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <a
                      href={s.virtualLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline truncate"
                    >
                      {s.virtualLink}
                    </a>
                  </div>
                )}

                {s.dogName && (
                  <div className="flex items-center gap-3">
                    <span className="text-base leading-none flex-shrink-0">🐕</span>
                    <p className="text-sm text-slate-700">{s.dogName}</p>
                  </div>
                )}

                {!isRichTextEmpty(s.description) && (
                  <div className="pt-1 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Notes</p>
                    <RichText html={s.description} className="text-sm text-slate-700" />
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100">
                  <SessionFormReport sessionId={s.id} sessionStatus={s.status} />
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )
}

// Splits the client's sessions into Upcoming vs Past sub-tabs, then groups each
// list by week (Mon–Sun).
function SessionsPanel({
  sessions,
  onConfirmDelete,
}: {
  sessions: TrainingSession[]
  onConfirmDelete: (id: string) => void
}) {
  const [sub, setSub] = useState<'upcoming' | 'past'>('upcoming')
  const now = Date.now()

  const upcoming = sessions
    .filter(s => new Date(s.scheduledAt).getTime() >= now)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
  const past = sessions
    .filter(s => new Date(s.scheduledAt).getTime() < now)
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())

  // No sentence when there's nothing here. "No sessions scheduled for this
  // client yet." sat directly beneath the Assign 1:1 session button — Karl,
  // 2026-08-06: "this is redundant". An empty state next to the action that
  // resolves it says the same thing twice, and the button is the fact and the
  // fix in one. The Sessions tile on the profile already reads "No sessions
  // yet" too. The action stays; the sentence goes.
  if (sessions.length === 0) return null

  const list = sub === 'upcoming' ? upcoming : past
  const weeks = groupByWeek(list)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl">
        <SubTabButton active={sub === 'upcoming'} onClick={() => setSub('upcoming')} label="Upcoming" count={upcoming.length} />
        <SubTabButton active={sub === 'past'} onClick={() => setSub('past')} label="Past" count={past.length} />
      </div>

      {/* Same rule: the sub-tab beside this one already carries the count.
          A sentence repeating a 0 is not worth twelve rows of padding. */}
      {list.length === 0 ? null : (
        <Card>
          <CardBody className="py-3">
            <ul className="flex flex-col -mx-2">
              {weeks.map(({ weekStartMs, items }, weekIdx) => (
                <li key={weekStartMs} className={weekIdx > 0 ? 'mt-3 pt-3 border-t border-slate-100' : ''}>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 px-2 mb-1">
                    Week of {new Date(weekStartMs).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                  </h3>
                  <ul className="flex flex-col">
                    {items.map(s => (
                      <li key={s.id}>
                        <ClientSessionRow
                          session={s}
                          trailing={
                            <button
                              onClick={() => onConfirmDelete(s.id)}
                              aria-label="Delete session"
                              className="h-6 w-6 min-h-0 min-w-0 self-center rounded-full flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

function SubTabButton({
  active, onClick, label, count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex-1 px-3 py-2 rounded-xl text-sm font-medium transition-colors ' +
        (active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')
      }
    >
      {label} <span className="ml-1 text-xs text-slate-400">({count})</span>
    </button>
  )
}

// Mon-anchored week start. Local-midnight ms for the Monday of the session's
// week, used as a stable group key.
function weekStartMs(d: Date): number {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayIdx = x.getDay() // 0=Sun..6=Sat
  const offset = dayIdx === 0 ? -6 : 1 - dayIdx
  x.setDate(x.getDate() + offset)
  return x.getTime()
}

function groupByWeek(list: TrainingSession[]): { weekStartMs: number; items: TrainingSession[] }[] {
  const map = new Map<number, TrainingSession[]>()
  for (const s of list) {
    const key = weekStartMs(new Date(s.scheduledAt))
    const arr = map.get(key) ?? []
    arr.push(s)
    map.set(key, arr)
  }
  // Preserve the input order (already sorted by the caller) when emitting
  // weeks: walk the original list and emit each week the first time it appears.
  const seen = new Set<number>()
  const out: { weekStartMs: number; items: TrainingSession[] }[] = []
  for (const s of list) {
    const key = weekStartMs(new Date(s.scheduledAt))
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ weekStartMs: key, items: map.get(key)! })
  }
  return out
}

const STATUS_PILL: Record<SessionStatus, string> = {
  UPCOMING:  'bg-blue-50 text-blue-700 border-blue-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  COMMENTED: 'bg-amber-50 text-amber-700 border-amber-200',
  INVOICED:  'bg-purple-50 text-purple-700 border-purple-200',
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  UPCOMING: 'Upcoming',
  COMPLETED: 'Completed',
  COMMENTED: 'Commented',
  INVOICED: 'Invoiced',
}

/**
 * The two-line session row, shared by the profile's "Upcoming sessions" card
 * and the Sessions page. Left: a small date tile. Right: title, then time ·
 * duration · dog, with a status pill on the far right. The "Upcoming" pill is
 * suppressed — inside an Upcoming list the status is implied by the section.
 */
export function ClientSessionRow({
  session: s,
  trailing,
  className,
}: {
  session: TrainingSession
  trailing?: React.ReactNode
  /** Overrides the row's own padding — e.g. flat-list density in a FlatBlock. */
  className?: string
}) {
  const d = new Date(s.scheduledAt)
  const dayNum = d.getDate()
  const monthShort = d.toLocaleDateString('en-NZ', { month: 'short' })
  const time = d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })
  const isPast = d.getTime() + s.durationMins * 60_000 < Date.now()
  const isInvoiced = s.invoicedAt != null || s.status === 'INVOICED'
  // Past + still UPCOMING means the trainer hasn't clicked Mark as complete
  // yet — surface it as "Pending" (awaiting wrap-up). "Done" sat too close to
  // "Completed" semantically; "Pending" makes the call-to-action explicit.
  const isPending = s.status === 'UPCOMING' && isPast
  const pillLabel = isPending ? 'Pending' : STATUS_LABEL[s.status]
  const pillClass = isPending ? 'bg-amber-50 text-amber-700 border-amber-200' : STATUS_PILL[s.status]
  const showPill = s.status !== 'UPCOMING' || isPending

  const row = (
    <Link
      href={`/sessions/${s.id}`}
      className={cn(
        'flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-colors flex-1 min-w-0',
        isPast ? 'hover:bg-slate-50' : 'hover:bg-blue-50/50',
        className,
      )}
    >
      <div className={cn(
        'flex flex-col items-center justify-center min-w-[40px] py-0.5 px-1.5 rounded-md text-center flex-shrink-0',
        isPast ? 'bg-slate-50 text-slate-500' : 'bg-blue-50/70 text-blue-700',
      )}>
        <span className="text-sm font-bold leading-tight tabular-nums">{dayNum}</span>
        <span className="text-[10px] font-medium leading-none opacity-70 uppercase">{monthShort}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 truncate leading-tight">{formatSessionTitle(s.title)}</p>
        <p className="text-xs text-slate-500 truncate leading-tight">
          {time} · {s.durationMins} min{s.dogName && <> · {s.dogName}</>}
        </p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {showPill && (
          <span className={cn(
            'inline-flex text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap',
            pillClass,
          )}>
            {pillLabel}
          </span>
        )}
        <span
          className={cn(
            'inline-flex items-center justify-center h-4 w-4 rounded-full',
            isInvoiced ? 'bg-emerald-500 text-white' : 'border border-rose-500 text-rose-500 bg-white',
          )}
          title={isInvoiced ? 'Invoiced' : 'Not invoiced'}
          aria-label={isInvoiced ? 'Invoiced' : 'Not invoiced'}
        >
          <CurrencyGlyph className="text-[10px]" />
        </span>
      </div>
    </Link>
  )

  if (!trailing) return row
  return (
    <div className="flex items-stretch gap-1">
      {row}
      {trailing}
    </div>
  )
}

// ─── Dogs ────────────────────────────────────────────────────────────────────

export function ClientDogsSection({
  dogs,
  dogFields,
  fieldValueMap,
  editHref = null,
}: {
  dogs: Dog[]
  dogFields: CustomField[]
  fieldValueMap: Record<string, string>
  /** Where a row's Edit goes — the trainer's existing dog editor. Null = read-only. */
  editHref?: string | null
}) {
  return (
    <div className={`grid gap-5 ${dogs.length > 1 ? 'md:grid-cols-2' : 'grid-cols-1 max-w-xl'}`}>
      {dogs.map(dog => {
        const dogFieldGroups = groupByCategory(dogFields)
        return (
          <Card key={dog.id} className="overflow-hidden">
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-slate-900 text-lg">🐕 {dog.name}</h2>
                {dog.deceasedAt && (
                  <span
                    className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
                    title={`Deceased ${new Date(dog.deceasedAt).toLocaleDateString()}`}
                  >
                    Deceased
                  </span>
                )}
              </div>
              {dog.breed && <p className="text-sm text-slate-500 mt-0.5">{dog.breed}</p>}
              {/* Edit belongs on the ROW — a client can have several dogs, and
                  one bar at the foot cannot say which one you meant. It opens
                  the trainer's existing editor rather than a third dog form. */}
              {editHref && (
                <Link href={editHref} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline">
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} /> Edit {dog.name}
                </Link>
              )}
            </div>

            <CardBody className="pt-4 pb-5">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mb-4">
                {dog.weight && (
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Weight</p>
                    <p className="text-slate-700 font-medium">{dog.weight} kg</p>
                  </div>
                )}
                {dog.dob && (
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Date of birth</p>
                    <p className="text-slate-700 font-medium">{formatDate(dog.dob)}</p>
                  </div>
                )}
                {dog.notes && (
                  <div className="col-span-2">
                    <p className="text-xs text-slate-400 mb-0.5">Notes</p>
                    <p className="text-slate-700">{dog.notes}</p>
                  </div>
                )}
              </div>

              {/* Trainer-curated gallery — the hero on the client's own home. */}
              <DogGalleryManager dogId={dog.id} />

              {dogFieldGroups.map(group => {
                const filledFields = group.items.filter(f => fieldValueMap[`${f.id}:${dog.id}`])
                if (filledFields.length === 0) return null
                return (
                  <div key={group.category ?? '__'} className="mt-2">
                    {group.category && (
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 pb-1 border-b border-slate-100">
                        {group.category}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                      {filledFields.map(field => {
                        const val = fieldValueMap[`${field.id}:${dog.id}`]
                        return (
                          <div key={field.id} className={val.length > 35 ? 'col-span-2' : ''}>
                            <p className="text-xs text-slate-400 mb-0.5">{field.label}</p>
                            <p className="text-slate-700">{val}</p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}

// ─── Communication ───────────────────────────────────────────────────────────

/**
 * Messaging and emails, split (Karl, 2026-08-06: "two tabs messaging / emails").
 *
 * They are two different records and a trainer looks for them separately: a
 * back-and-forth thread with the client, versus the log of what has been SENT
 * to them — bulk broadcasts, session notes, reminders. Interleaved, a chat
 * reply sat between two marketing emails.
 *
 * The strip is `OfferingTabs`, the house pill strip the offering and membership
 * screens already use — not a third tab treatment.
 *
 * The thread itself is NOT embedded here. /messages is a split-pane screen with
 * its own sticky composer, and mounting it under EditScreen's pinned bar is two
 * sticky layers on one phone — the shape that breaks the "never two scrollbars"
 * rule. The action opens it instead.
 */
export function ClientCommsSection({
  clientId,
  communications,
}: {
  clientId: string
  communications: CommItem[]
}) {
  const [tab, setTab] = useState<'messages' | 'emails'>('messages')
  const messages = communications.filter(c => c.kind === 'message')
  const emails = communications.filter(c => c.kind === 'email')
  const shown = tab === 'messages' ? messages : emails

  return (
    <div className="flex flex-col gap-4">
      <OfferingTabs
        label="Communication"
        tabs={[
          { id: 'messages' as const, label: 'Messaging', icon: MessageSquare, badge: messages.length || undefined },
          { id: 'emails' as const, label: 'Emails', icon: Mail, badge: emails.length || undefined },
        ]}
        value={tab}
        onChange={setTab}
      />
      {/* No apology when a tab is empty: "Send a message" is pinned to the foot
          of the screen, and an empty state beside the action that resolves it
          says the same thing twice. */}
      {shown.length > 0 && (
        <div className="flex flex-col gap-2">
          {shown.map(c => <CommunicationRow key={c.id} item={c} />)}
        </div>
      )}
      <Link href={`/messages?client=${clientId}`} className="self-start text-xs font-medium text-blue-600 hover:underline">
        Open message thread →
      </Link>
    </div>
  )
}

// One row: a bulk email (with open/click status), a one-off email, or a chat
// message, in/outbound.
export function CommunicationRow({ item }: { item: CommItem }) {
  const date = new Date(item.date)
  const when = date.toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

  const statusBadge = (() => {
    switch (item.status) {
      case 'CLICKED': return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"><MousePointerClick className="h-3 w-3" />Clicked</span>
      case 'OPENED': return <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700"><MailOpen className="h-3 w-3" />Opened</span>
      case 'DELIVERED': return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Delivered</span>
      case 'BOUNCED': case 'FAILED': case 'COMPLAINED': return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700"><AlertTriangle className="h-3 w-3" />Bounced</span>
      case 'SENT': return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Sent</span>
      default: return null
    }
  })()

  const Icon = item.kind === 'email' ? Mail : MessageSquare
  return (
    <Card className="px-4 py-3 flex items-center gap-3">
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${item.direction === 'outbound' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
        {item.direction === 'outbound' ? <Send className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{item.subject || (item.kind === 'email' ? 'Email' : 'Message')}</p>
        <p className="text-xs text-slate-400">
          {item.direction === 'outbound' ? 'You' : 'Client'} · {item.kind === 'email' ? 'Email' : 'Message'} · {when}
        </p>
      </div>
      {statusBadge}
    </Card>
  )
}

// ─── Details ─────────────────────────────────────────────────────────────────

export function ClientDetailsSection({
  clientId,
  canEdit,
  contact,
  status,
  ownerFields,
  fieldValueMap,
}: {
  clientId: string
  canEdit: boolean
  contact: ClientContact
  status: string
  ownerFields: CustomField[]
  fieldValueMap: Record<string, string>
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* Built-in contact card first — email, phone, and the relationship start
          date. Trainer-defined fields render below in their own grouped cards. */}
      <Card>
        <CardBody className="pt-5">
          <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
            <h2 className="font-semibold text-slate-900">Contact</h2>
            {canEdit && <StatusToggle clientId={clientId} initialStatus={status} />}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 text-sm">
            <div className={displayEmail(contact.email) && contact.email!.length > 32 ? 'sm:col-span-2' : ''}>
              <p className="text-xs text-slate-400 mb-0.5">Email</p>
              {displayEmail(contact.email) ? (
                <a href={`mailto:${contact.email}`} className="text-blue-600 hover:underline break-all">{contact.email}</a>
              ) : (
                <p className="text-slate-300">—</p>
              )}
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Phone</p>
              {contact.phone ? (
                <a href={`tel:${contact.phone}`} className="text-blue-600 hover:underline">{contact.phone}</a>
              ) : (
                <p className="text-slate-300">—</p>
              )}
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Client since</p>
              <p className="text-slate-800">{contact.clientSince}</p>
            </div>
            {contact.address && (
              <div className="sm:col-span-2">
                <p className="text-xs text-slate-400 mb-0.5">Address</p>
                <p className="text-slate-800">{contact.address}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-slate-400 mb-0.5">From base</p>
              {contact.distanceFromBase ? (
                <p className="text-slate-800">{contact.distanceFromBase}</p>
              ) : (
                <p className="text-slate-300">—</p>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
      {ownerFields.length === 0 ? null : (
        groupByCategory(ownerFields).map(group => (
          <Card key={group.category ?? '__uncategorised__'}>
            <CardBody className="pt-5">
              <h2 className="font-semibold text-slate-900 mb-5">
                {group.category ?? 'Additional details'}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 text-sm">
                {group.items.map(field => {
                  const val = fieldValueMap[field.id]
                  return (
                    <div key={field.id} className={val && val.length > 40 ? 'sm:col-span-2 lg:col-span-3' : ''}>
                      <p className="text-xs text-slate-400 mb-0.5">{field.label}</p>
                      <p className={val ? 'text-slate-800' : 'text-slate-300'}>{val || '—'}</p>
                    </div>
                  )
                })}
              </div>
            </CardBody>
          </Card>
        ))
      )}
    </div>
  )
}

export function groupByCategory<T extends { category: string | null }>(items: T[]) {
  const groups: { category: string | null; items: T[] }[] = []
  const seen = new Set<string | null>()
  for (const item of items) {
    const key = item.category ?? null
    if (!seen.has(key)) {
      seen.add(key)
      groups.push({ category: key, items: items.filter(x => (x.category ?? null) === key) })
    }
  }
  return groups
}
