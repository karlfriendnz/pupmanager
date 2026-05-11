'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Card, CardBody } from '@/components/ui/card'
import { formatDate, cn, formatSessionTitle } from '@/lib/utils'
import { X, MapPin, Video, Clock, Calendar, Trash2, AlertTriangle, Play, ShoppingBag, Plus, Check, Loader2, Tag, Package as PackageIcon, FileDown, DollarSign, Home, PawPrint, Trophy, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SessionFormReport } from '@/components/session-form-report'
import { ClientAchievementsPanel } from './client-achievements-panel'
import { StatusToggle } from './status-toggle'
import Link from 'next/link'

type Tab = 'overview' | 'sessions' | 'dogs' | 'details' | 'achievements'

interface Dog {
  id: string
  name: string
  breed: string | null
  weight: number | null
  dob: string | null   // pre-serialised ISO string
  notes: string | null
}

interface Task {
  id: string
  title: string
  date: string         // pre-serialised ISO string
  dogId: string | null
  completed: boolean
}

type SessionStatus = 'UPCOMING' | 'COMPLETED' | 'COMMENTED' | 'INVOICED'

const STATUS_OPTIONS: { value: SessionStatus; label: string; colour: string }[] = [
  { value: 'UPCOMING',  label: 'Upcoming',  colour: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'COMPLETED', label: 'Completed', colour: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'COMMENTED', label: 'Commented', colour: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'INVOICED',  label: 'Invoiced',  colour: 'bg-purple-100 text-purple-700 border-purple-200' },
]

interface TrainingSession {
  id: string
  title: string
  scheduledAt: string   // ISO string
  durationMins: number
  sessionType: string
  status: SessionStatus
  invoicedAt: string | null
  location: string | null
  virtualLink: string | null
  description: string | null
  dogName: string | null
}

interface CustomField {
  id: string
  label: string
  appliesTo: 'OWNER' | 'DOG'
  category: string | null
}

interface Stats {
  complianceRate: number | null
  completedTasks: number
  totalTasks: number
}

interface ShopProduct {
  id: string
  name: string
  kind: 'PHYSICAL' | 'DIGITAL'
  priceCents: number | null
  imageUrl: string | null
  category: string | null
}

interface PendingProductRequest {
  id: string
  note: string | null
  product: { id: string; name: string; kind: 'PHYSICAL' | 'DIGITAL'; imageUrl: string | null }
}

interface Props {
  clientId: string
  canEdit: boolean
  stats: Stats
  dogs: Dog[]
  tasks: Task[]
  sessions: TrainingSession[]
  customFields: CustomField[]
  fieldValueMap: Record<string, string>
  dogNames: Record<string, string>  // dogId → name
  products: ShopProduct[]
  pendingProductRequests: PendingProductRequest[]
  // Built-in contact fields surfaced at the top of the Details tab so
  // the trainer-defined custom fields aren't the only thing there. The
  // page header used to render these and got noisy.
  contact: { email: string | null; phone: string | null; clientSince: string }
  // ACTIVE / INACTIVE / NEW — used to render the status toggle inside
  // the Contact card on the Details tab (used to live in the page
  // header but cluttered the top of the page).
  status: string
}

function groupByCategory<T extends { category: string | null }>(items: T[]) {
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

export function ClientProfileTabs({
  clientId,
  canEdit,
  stats,
  dogs,
  tasks,
  sessions: initialSessions,
  customFields,
  fieldValueMap,
  dogNames,
  products,
  pendingProductRequests: initialPendingRequests,
  contact,
  status,
}: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [pendingRequests, setPendingRequests] = useState(initialPendingRequests)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null)

  async function dismissRequest(requestId: string) {
    if (busyRequestId) return
    setBusyRequestId(requestId)
    const removed = pendingRequests.find(r => r.id === requestId)
    setPendingRequests(prev => prev.filter(r => r.id !== requestId))
    try {
      const res = await fetch(`/api/product-requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      })
      if (!res.ok && removed) setPendingRequests(prev => [...prev, removed])
    } catch {
      if (removed) setPendingRequests(prev => [...prev, removed])
    } finally {
      setBusyRequestId(null)
    }
  }

  async function addProductRequest(productId: string) {
    const res = await fetch(`/api/clients/${clientId}/product-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId }),
    })
    if (!res.ok) return
    const created = await res.json()
    const product = products.find(p => p.id === productId)
    if (!product) return
    // Avoid duplicate state if the API returned an existing PENDING row.
    setPendingRequests(prev => {
      if (prev.some(r => r.id === created.id)) return prev
      return [...prev, {
        id: created.id,
        note: created.note ?? null,
        product: { id: product.id, name: product.name, kind: product.kind, imageUrl: product.imageUrl },
      }]
    })
  }

  const [sessions, setSessions] = useState(initialSessions)
  const [activeSession, setActiveSession] = useState<TrainingSession | null>(null)
  const [savingStatus, setSavingStatus] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const searchParams = useSearchParams()
  const router = useRouter()

  // Auto-open session modal when ?sessionId= is in the URL
  useEffect(() => {
    const sessionId = searchParams.get('sessionId')
    if (sessionId) {
      const found = sessions.find(s => s.id === sessionId) ?? null
      if (found) {
        setTab('sessions')
        setActiveSession(found)
      }
    }
  }, [searchParams, sessions])

  // Keep the local sessions list in sync with server-fetched data after router.refresh()
  // (e.g. after assigning a package, deleting outside this component, etc.)
  useEffect(() => {
    setSessions(initialSessions)
  }, [initialSessions])

  // External callers (e.g. the AssignPackage modal) can request a tab switch
  // by navigating to ?tab=sessions. We honour it once and strip the param.
  useEffect(() => {
    if (searchParams.get('tab') === 'sessions') {
      setTab('sessions')
      const url = new URL(window.location.href)
      url.searchParams.delete('tab')
      router.replace(url.pathname + (url.search || ''), { scroll: false })
    }
  }, [searchParams, router])

  function closeModal() {
    setActiveSession(null)
    // Remove sessionId from URL without a full navigation
    const url = new URL(window.location.href)
    url.searchParams.delete('sessionId')
    router.replace(url.pathname + (url.search || ''), { scroll: false })
  }

  async function handleStatusChange(sessionId: string, status: SessionStatus) {
    setSavingStatus(true)
    // Optimistic update
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

  const ownerFields = customFields.filter(f => f.appliesTo === 'OWNER')
  const dogFields   = customFields.filter(f => f.appliesTo === 'DOG')

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }[] = [
    { id: 'overview',     label: 'Overview',     icon: Home },
    { id: 'sessions',     label: 'Sessions',     icon: Calendar, badge: sessions.length > 0 ? sessions.length : undefined },
    { id: 'dogs',         label: dogs.length > 1 ? 'Dogs' : 'Dog', icon: PawPrint, badge: dogs.length > 1 ? dogs.length : undefined },
    { id: 'achievements', label: 'Achievements', icon: Trophy },
    { id: 'details',      label: 'Details',      icon: Info },
  ]

  return (
    <>
      {/* Tab bar — iOS-style icon-on-top, tiny-label-below. Five tabs split
          the row evenly so each is a comfortable tap target on phones
          without scrolling. */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl mb-8">
        {tabs.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 px-1 py-2 rounded-xl transition-all duration-150 ${
                tab === t.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="text-[10px] font-medium leading-tight">{t.label}</span>
              {t.badge != null && (
                <span className={`absolute top-1 right-1 min-w-4 h-4 px-1 text-[9px] font-semibold tabular-nums rounded-full flex items-center justify-center ${
                  tab === t.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                }`}>
                  {t.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="flex flex-col gap-6">
          {/* Previous week / Upcoming week — rolling 7-day windows around now */}
          <OverviewWeekPanels sessions={sessions} />

          {/* Bring to next session */}
          {canEdit && (
            <Card>
              <CardBody className="py-5">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h2 className="text-sm font-semibold text-slate-900">Bring to next session</h2>
                  {products.length > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add product
                    </Button>
                  )}
                </div>

                {pendingRequests.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    {products.length === 0
                      ? <>No products yet — <Link href="/products" className="text-blue-600 hover:underline">add some to your shop</Link>.</>
                      : 'No items pending.'}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {pendingRequests.map(r => (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 bg-amber-50 border border-amber-100 pl-3 pr-1.5 py-1 rounded-full"
                        title={r.note ?? undefined}
                      >
                        {r.product.name}
                        <button
                          onClick={() => dismissRequest(r.id)}
                          disabled={busyRequestId === r.id}
                          aria-label={`Remove ${r.product.name}`}
                          className="ml-1 h-5 w-5 rounded-full hover:bg-amber-100 flex items-center justify-center text-amber-700 disabled:opacity-50"
                        >
                          {busyRequestId === r.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <X className="h-3 w-3" />}
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {/* Recent tasks */}
          <Card>
            <CardBody className="py-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Recent tasks</h2>
              {tasks.length === 0 ? (
                <p className="text-sm text-slate-400">No tasks assigned yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-slate-100 -mx-2">
                  {tasks.map(task => (
                    <li key={task.id} className="flex items-center gap-3 px-2 py-2.5">
                      <span className={`h-6 w-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                        task.completed ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
                      }`}>
                        {task.completed ? '✓' : '○'}
                      </span>
                      <span className="text-sm text-slate-700 flex-1 min-w-0 truncate">{task.title}</span>
                      {task.dogId && dogNames[task.dogId] && (
                        <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full flex-shrink-0">
                          {dogNames[task.dogId]}
                        </span>
                      )}
                      <span className="text-xs text-slate-400 flex-shrink-0 tabular-nums">{formatDate(task.date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Stat cards — pinned to the bottom while the compliance / tasks
              numbers are still being designed. Each card shares the same
              structural shape: big number, uppercase label, single small
              subtitle line. Heights match because the grid uses auto-rows-fr. */}
          <div className="grid grid-cols-3 gap-4 auto-rows-fr">
            <Card className="p-5 flex flex-col items-center text-center">
              <p className={`text-4xl font-bold leading-none ${
                stats.complianceRate == null ? 'text-slate-300'
                : stats.complianceRate >= 70 ? 'text-emerald-600'
                : stats.complianceRate >= 40 ? 'text-amber-500'
                : 'text-rose-500'
              }`}>
                {stats.complianceRate != null ? `${stats.complianceRate}%` : '—'}
              </p>
              <p className="mt-2 text-[11px] text-slate-500 font-semibold uppercase tracking-wide">14-day compliance</p>
              <p className="mt-1 text-xs text-slate-400">last 14 days</p>
            </Card>

            <Card className="p-5 flex flex-col items-center text-center">
              <p className="text-4xl font-bold text-slate-900 leading-none">{stats.completedTasks}</p>
              <p className="mt-2 text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Tasks completed</p>
              <p className="mt-1 text-xs text-slate-400">of {stats.totalTasks} assigned</p>
            </Card>

            <Card className="p-5 flex flex-col items-center text-center">
              <p className="text-4xl font-bold text-slate-900 leading-none">{stats.totalTasks - stats.completedTasks}</p>
              <p className="mt-2 text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Remaining</p>
              <p className="mt-1 text-xs text-slate-400">last 14 days</p>
            </Card>
          </div>
        </div>
      )}

      {/* ── Sessions ─────────────────────────────────────────────────────── */}
      {tab === 'sessions' && (
        <SessionsTabPanel
          sessions={sessions}
          onConfirmDelete={(id) => setConfirmDelete({ ids: [id] })}
        />
      )}

      {/* ── Delete confirmation modal ─────────────────────────────────────── */}
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

      {/* ── Session detail modal ──────────────────────────────────────────── */}
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
              {/* Header */}
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

              {/* Body */}
              <div className="px-6 py-5 flex flex-col gap-4">
                {/* Status picker */}
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

                {/* Date & time */}
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

                {/* Duration */}
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-slate-400 flex-shrink-0" />
                  <p className="text-sm text-slate-700">{s.durationMins} minutes</p>
                </div>

                {/* Location */}
                {s.location && (
                  <div className="flex items-start gap-3">
                    <MapPin className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-slate-700">{s.location}</p>
                  </div>
                )}

                {/* Virtual link */}
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

                {/* Dog */}
                {s.dogName && (
                  <div className="flex items-center gap-3">
                    <span className="text-base leading-none flex-shrink-0">🐕</span>
                    <p className="text-sm text-slate-700">{s.dogName}</p>
                  </div>
                )}

                {/* Description */}
                {s.description && (
                  <div className="pt-1 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Notes</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{s.description}</p>
                  </div>
                )}

                {/* Session report (forms) */}
                <div className="pt-3 border-t border-slate-100">
                  <SessionFormReport sessionId={s.id} />
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Dogs ─────────────────────────────────────────────────────────── */}
      {tab === 'dogs' && (
        <div className={`grid gap-5 ${dogs.length > 1 ? 'md:grid-cols-2' : 'grid-cols-1 max-w-xl'}`}>
          {dogs.map(dog => {
            const dogFieldGroups = groupByCategory(dogFields)
            return (
              <Card key={dog.id} className="overflow-hidden">
                {/* Dog header */}
                <div className="bg-gradient-to-br from-slate-50 to-slate-100 px-5 py-4 border-b border-slate-100">
                  <h2 className="font-bold text-slate-900 text-lg">🐕 {dog.name}</h2>
                  {dog.breed && <p className="text-sm text-slate-500 mt-0.5">{dog.breed}</p>}
                </div>

                <CardBody className="pt-4 pb-5">
                  {/* Core vitals */}
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

                  {/* Dog-specific custom fields */}
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
      )}

      {/* ── Achievements ─────────────────────────────────────────────────── */}
      {tab === 'achievements' && (
        <ClientAchievementsPanel clientId={clientId} canEdit={canEdit} />
      )}

      {/* ── Details ──────────────────────────────────────────────────────── */}
      {tab === 'details' && (
        <div className="flex flex-col gap-6">
          {/* Built-in contact card always shown first — email, phone, and
              the relationship start date. Trainer-defined fields render
              below in their own grouped cards. */}
          <Card>
            <CardBody className="pt-5">
              <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
                <h2 className="font-semibold text-slate-900">Contact</h2>
                {canEdit && <StatusToggle clientId={clientId} initialStatus={status} />}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 text-sm">
                <div className={contact.email && contact.email.length > 32 ? 'sm:col-span-2' : ''}>
                  <p className="text-xs text-slate-400 mb-0.5">Email</p>
                  {contact.email ? (
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
                          <p className={val ? 'text-slate-800' : 'text-slate-300'}>
                            {val || '—'}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </CardBody>
              </Card>
            ))
          )}
        </div>
      )}

      {pickerOpen && (
        <ProductPickerModal
          products={products}
          requestedIds={new Set(pendingRequests.map(r => r.product.id))}
          onClose={() => setPickerOpen(false)}
          onPick={async (id) => { await addProductRequest(id) }}
        />
      )}
    </>
  )
}

function ProductPickerModal({
  products,
  requestedIds,
  onClose,
  onPick,
}: {
  products: ShopProduct[]
  requestedIds: Set<string>
  onClose: () => void
  onPick: (productId: string) => void | Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const filtered = products.filter(p =>
    !search.trim() || p.name.toLowerCase().includes(search.toLowerCase())
      || (p.category ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // Group by category for the picker — same shape as /products grid
  const groups: { category: string | null; items: ShopProduct[] }[] = []
  const seen = new Set<string | null>()
  for (const p of filtered) {
    const key = p.category ?? null
    if (!seen.has(key)) {
      seen.add(key)
      groups.push({ category: key, items: filtered.filter(x => (x.category ?? null) === key) })
    }
  }

  async function pick(id: string) {
    setBusyId(id)
    try { await onPick(id) }
    finally { setBusyId(null) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-900">Add to next session</h2>
            <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="px-5 py-4">
          {filtered.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No products match.</p>
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map(g => (
                <div key={g.category ?? '_'}>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-2 flex items-center gap-1.5">
                    <Tag className="h-3 w-3" /> {g.category ?? 'Uncategorised'}
                  </p>
                  <div className="flex flex-col">
                    {g.items.map(p => {
                      const already = requestedIds.has(p.id)
                      return (
                        <button
                          key={p.id}
                          onClick={() => !already && pick(p.id)}
                          disabled={already || busyId === p.id}
                          className={`flex items-center gap-3 px-2 py-2 -mx-2 rounded-xl text-left transition-colors ${
                            already ? 'opacity-60 cursor-default' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {p.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                            ) : p.kind === 'DIGITAL' ? (
                              <FileDown className="h-4 w-4 text-violet-500" />
                            ) : (
                              <PackageIcon className="h-4 w-4 text-amber-600" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{p.name}</p>
                            <p className="text-xs text-slate-500">
                              {p.priceCents != null ? `$${(p.priceCents / 100).toFixed(2)}` : 'Contact'}
                              {' · '}
                              {p.kind === 'DIGITAL' ? 'Digital' : 'Physical'}
                            </p>
                          </div>
                          {already ? (
                            <span className="text-xs font-medium text-emerald-600 flex items-center gap-1 flex-shrink-0">
                              <Check className="h-3.5 w-3.5" /> Added
                            </span>
                          ) : busyId === p.id ? (
                            <Loader2 className="h-4 w-4 animate-spin text-slate-400 flex-shrink-0" />
                          ) : (
                            <Plus className="h-4 w-4 text-slate-400 flex-shrink-0" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Overview week panels ──────────────────────────────────────────────────
//
// Two compact lists on the Overview tab — last 7 days, next 7 days. Same
// SessionRowCard the Sessions tab uses, with showDate so the trainer can
// orient at a glance without opening the full Sessions tab.

function OverviewWeekPanels({ sessions }: { sessions: TrainingSession[] }) {
  const now = Date.now()
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

  const previousWeek = sessions
    .filter(s => {
      const t = new Date(s.scheduledAt).getTime()
      return t >= now - sevenDaysMs && t < now
    })
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())

  const upcomingWeek = sessions
    .filter(s => {
      const t = new Date(s.scheduledAt).getTime()
      return t >= now && t < now + sevenDaysMs
    })
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <WeekPanel title="Previous week" sessions={previousWeek} emptyText="No sessions in the last 7 days." />
      <WeekPanel title="Upcoming week" sessions={upcomingWeek} emptyText="No sessions in the next 7 days." />
    </div>
  )
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

// Shared two-line session row used on the Overview week panels and the
// Sessions tab. Left: small date tile (DAY / NN / MON). Right: title on
// line one, time · duration · dog on line two, optional status pill on
// the far right. The "Upcoming" pill is suppressed — when these rows
// live inside Past / Upcoming sub-tabs or week panels, the status is
// implied by the section.

function ClientSessionRow({
  session: s,
  trailing,
}: {
  session: TrainingSession
  trailing?: React.ReactNode
}) {
  const d = new Date(s.scheduledAt)
  const dayNum = d.getDate()
  const monthShort = d.toLocaleDateString('en-NZ', { month: 'short' })
  const time = d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })
  const isPast = d.getTime() + s.durationMins * 60_000 < Date.now()
  const isInvoiced = s.invoicedAt != null || s.status === 'INVOICED'
  // Past + still UPCOMING means the trainer hasn't clicked Mark as
  // complete yet — surface it as "Pending" (awaiting wrap-up). "Done"
  // sat too close to "Completed" semantically; "Pending" makes the
  // call-to-action explicit.
  const isPending = s.status === 'UPCOMING' && isPast
  const pillLabel = isPending ? 'Pending' : STATUS_LABEL[s.status]
  const pillClass = isPending ? 'bg-amber-50 text-amber-700 border-amber-200' : STATUS_PILL[s.status]
  // Suppress only the future-Upcoming case; everything else (Pending +
  // Completed + Commented + Invoiced) gets a pill.
  const showPill = s.status !== 'UPCOMING' || isPending

  const row = (
    <Link
      href={`/sessions/${s.id}`}
      className={cn(
        'flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-colors flex-1 min-w-0',
        isPast ? 'hover:bg-slate-50' : 'hover:bg-blue-50/50',
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
            isInvoiced
              ? 'bg-emerald-500 text-white'
              : 'border border-rose-500 text-rose-500 bg-white',
          )}
          title={isInvoiced ? 'Invoiced' : 'Not invoiced'}
          aria-label={isInvoiced ? 'Invoiced' : 'Not invoiced'}
        >
          <DollarSign className="h-2.5 w-2.5" strokeWidth={2.5} />
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

function WeekPanel({
  title,
  sessions,
  emptyText,
}: {
  title: string
  sessions: TrainingSession[]
  emptyText: string
}) {
  return (
    <Card>
      <CardBody className="py-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">{title}</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-slate-400">{emptyText}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100 -mx-2">
            {sessions.map(s => (
              <li key={s.id}>
                <ClientSessionRow session={s} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

// ─── Sessions tab panel ─────────────────────────────────────────────────────
//
// Splits the client's sessions into Upcoming vs Past sub-tabs, then groups
// each list by week (Mon–Sun). Each row uses the shared SessionRowCard with
// `showDate` on so the trainer can scan dates without opening sessions.

function SessionsTabPanel({
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

  if (sessions.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p>No sessions scheduled for this client yet.</p>
      </div>
    )
  }

  const list = sub === 'upcoming' ? upcoming : past
  const weeks = groupByWeek(list)

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl">
        <SubTabButton
          active={sub === 'upcoming'}
          onClick={() => setSub('upcoming')}
          label="Upcoming"
          count={upcoming.length}
        />
        <SubTabButton
          active={sub === 'past'}
          onClick={() => setSub('past')}
          label="Past"
          count={past.length}
        />
      </div>

      {list.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          {sub === 'upcoming' ? 'No upcoming sessions.' : 'No past sessions.'}
        </div>
      ) : (
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
                              className="h-6 w-6 self-center rounded-full flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
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
  active,
  onClick,
  label,
  count,
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
      {label} <span className={'ml-1 text-xs ' + (active ? 'text-slate-400' : 'text-slate-400')}>({count})</span>
    </button>
  )
}

// Mon-anchored week start. Returns local-midnight ms for the Monday of the
// session's week, used as a stable group key.
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
  // Preserve the input order (already sorted asc/desc by caller) when
  // emitting weeks: walk the original list and emit each week the first
  // time we encounter it.
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
