'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Card, CardBody } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { X, MapPin, Video, Clock, Calendar, Trash2, AlertTriangle, Play, ShoppingBag, Plus, Check, Loader2, Tag, Package as PackageIcon, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SessionFormReport } from '@/components/session-form-report'
import { ClientAchievementsPanel } from './client-achievements-panel'
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
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

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
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
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const id of successful) next.delete(id)
      return next
    })
    setDeleting(false)
    setConfirmDelete(null)
  }

  const ownerFields = customFields.filter(f => f.appliesTo === 'OWNER')
  const dogFields   = customFields.filter(f => f.appliesTo === 'DOG')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview',  label: 'Overview' },
    { id: 'sessions',  label: sessions.length > 0 ? `Sessions (${sessions.length})` : 'Sessions' },
    { id: 'dogs',      label: dogs.length > 1 ? `Dogs (${dogs.length})` : 'Dog' },
    { id: 'achievements', label: 'Achievements' },
    { id: 'details',   label: 'Details' },
  ]

  return (
    <>
      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl mb-8">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
              tab === t.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="flex flex-col gap-6">
          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-4">
            <Card className="p-5 text-center">
              <p className={`text-4xl font-bold mb-1 ${
                stats.complianceRate == null ? 'text-slate-300'
                : stats.complianceRate >= 70 ? 'text-green-600'
                : stats.complianceRate >= 40 ? 'text-amber-500'
                : 'text-red-500'
              }`}>
                {stats.complianceRate != null ? `${stats.complianceRate}%` : '—'}
              </p>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">14-day compliance</p>
              {stats.complianceRate != null && (
                <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      stats.complianceRate >= 70 ? 'bg-green-500'
                      : stats.complianceRate >= 40 ? 'bg-amber-400'
                      : 'bg-red-400'
                    }`}
                    style={{ width: `${stats.complianceRate}%` }}
                  />
                </div>
              )}
            </Card>

            <Card className="p-5 text-center">
              <p className="text-4xl font-bold text-slate-900 mb-1">{stats.completedTasks}</p>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Tasks completed</p>
              <p className="text-xs text-slate-300 mt-2">of {stats.totalTasks} assigned</p>
            </Card>

            <Card className="p-5 text-center">
              <p className="text-4xl font-bold text-slate-900 mb-1">{stats.totalTasks - stats.completedTasks}</p>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Remaining</p>
              <p className="text-xs text-slate-300 mt-2">in last 14 days</p>
            </Card>
          </div>

          {/* Bring to next session */}
          {canEdit && (
            <Card>
              <CardBody className="pt-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                      <ShoppingBag className="h-4 w-4 text-amber-600" />
                      Bring to next session
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Items for this client&apos;s next upcoming session. Roll forward until fulfilled.
                    </p>
                  </div>
                  {products.length > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add product
                    </Button>
                  )}
                </div>

                {pendingRequests.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">
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
            <CardBody className="pt-5">
              <h2 className="font-semibold text-slate-900 mb-4">Recent tasks</h2>
              {tasks.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">No tasks assigned yet.</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {tasks.map(task => (
                    <div key={task.id} className="flex items-center gap-3 py-2.5">
                      <span className={`h-6 w-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                        task.completed ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'
                      }`}>
                        {task.completed ? '✓' : '○'}
                      </span>
                      <span className="text-sm text-slate-700 flex-1 min-w-0 truncate">{task.title}</span>
                      {task.dogId && dogNames[task.dogId] && (
                        <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full flex-shrink-0">
                          {dogNames[task.dogId]}
                        </span>
                      )}
                      <span className="text-xs text-slate-400 flex-shrink-0">{formatDate(task.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* ── Sessions ─────────────────────────────────────────────────────── */}
      {tab === 'sessions' && (
        <div className="flex flex-col gap-3">
          {/* Selection toolbar */}
          {selectedIds.size > 0 && (
            <div className="sticky top-2 z-10 flex items-center justify-between gap-3 bg-white border border-blue-200 rounded-xl px-4 py-2.5 shadow-sm">
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium text-slate-900">
                  {selectedIds.size} selected
                </span>
                <button
                  onClick={clearSelection}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  Clear
                </button>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setConfirmDelete({ ids: Array.from(selectedIds) })}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          )}

          {sessions.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>No sessions scheduled for this client yet.</p>
            </div>
          ) : (
            sessions.map(s => {
              const d = new Date(s.scheduledAt)
              const isPast = d < new Date()
              const isSelected = selectedIds.has(s.id)
              return (
                <Card
                  key={s.id}
                  className={`cursor-pointer transition-all ${
                    isSelected
                      ? 'border-blue-400 ring-2 ring-blue-100'
                      : 'hover:border-blue-200 hover:shadow-md'
                  } ${isPast ? 'opacity-70' : ''}`}
                  onClick={() => router.push(`/sessions/${s.id}`)}
                >
                  <CardBody className="pt-4 pb-4">
                    <div className="flex items-start gap-4">
                      {/* Selection checkbox */}
                      <label
                        className="flex-shrink-0 mt-0.5 cursor-pointer"
                        onClick={e => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(s.id)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </label>

                      <div className="flex-shrink-0 text-center min-w-[52px]">
                        <p className="text-xs font-bold text-blue-600">
                          {d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })}
                        </p>
                        <p className="text-xs text-slate-400">{s.durationMins}m</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 truncate">{s.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                          {s.dogName ? ` · 🐕 ${s.dogName}` : ''}
                        </p>
                        {s.location && <p className="text-xs text-slate-400 mt-0.5">{s.location}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          s.sessionType === 'VIRTUAL'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {s.sessionType === 'VIRTUAL' ? 'Virtual' : 'In person'}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                          STATUS_OPTIONS.find(o => o.value === s.status)?.colour ?? 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          {STATUS_OPTIONS.find(o => o.value === s.status)?.label ?? s.status}
                        </span>
                      </div>
                      {/* Start session — opens the full-page form view */}
                      <Link
                        href={`/sessions/${s.id}`}
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors flex-shrink-0"
                      >
                        <Play className="h-3 w-3" />
                        Start session
                      </Link>
                      {/* Per-card delete */}
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDelete({ ids: [s.id] }) }}
                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                        aria-label="Delete session"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </CardBody>
                </Card>
              )
            })
          )}
        </div>
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
          {ownerFields.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>No owner fields defined yet.</p>
              <p className="text-sm mt-1">Add fields in Settings → Custom fields.</p>
            </div>
          ) : (
            groupByCategory(ownerFields).map(group => (
              <Card key={group.category ?? '__uncategorised__'}>
                <CardBody className="pt-5">
                  <h2 className="font-semibold text-slate-900 mb-5">
                    {group.category ?? 'Additional details'}
                  </h2>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 text-sm">
                    {group.items.map(field => {
                      const val = fieldValueMap[field.id]
                      return (
                        <div key={field.id} className={val && val.length > 40 ? 'col-span-2 lg:col-span-3' : ''}>
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
