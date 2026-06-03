'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2, X, Check, LogIn } from 'lucide-react'
import { formatDate } from '@/lib/utils'

type Trainer = {
  id: string
  name: string | null
  email: string
  businessName: string | null
  subscriptionPlanName: string | null
  subscriptionStatus: string | null
  clientCount: number
  onboardingCompleted: number
  onboardingTotal: number
  onboardingEmails: number
  gracePeriodUntil: Date | string | null
  createdAt: Date
}

export function TrainerRow({ trainer }: { trainer: Trainer }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(trainer.name ?? '')
  const [email, setEmail] = useState(trainer.email)
  const [businessName, setBusinessName] = useState(trainer.businessName ?? '')

  async function handleSave() {
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/admin/trainers/${trainer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, businessName }),
    })
    if (res.ok) {
      setEditing(false)
      router.refresh()
    } else {
      const data = await res.json()
      setError(typeof data.error === 'string' ? data.error : 'Failed to save')
    }
    setSaving(false)
  }

  async function handleDelete() {
    setDeleting(true)
    const res = await fetch(`/api/admin/trainers/${trainer.id}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
    setDeleting(false)
    setConfirmDelete(false)
  }

  // Grant (days > 0) or clear (days === null) an access grace period.
  const [savingGrace, setSavingGrace] = useState(false)
  async function setGrace(days: number | null) {
    setSavingGrace(true)
    setError(null)
    const gracePeriodUntil =
      days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    const res = await fetch(`/api/admin/trainers/${trainer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gracePeriodUntil }),
    })
    if (res.ok) router.refresh()
    else setError('Failed to update grace period')
    setSavingGrace(false)
  }

  const graceUntil = trainer.gracePeriodUntil ? new Date(trainer.gracePeriodUntil) : null
  const graceActive = !!graceUntil && graceUntil.getTime() > Date.now()

  if (editing) {
    return (
      <tr className="border-b border-slate-700/50 bg-slate-700/40">
        <td colSpan={9} className="px-4 py-4">
          {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="h-9 rounded-lg bg-slate-800 border border-slate-600 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Email</label>
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="h-9 rounded-lg bg-slate-800 border border-slate-600 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Business name</label>
              <input
                value={businessName}
                onChange={e => setBusinessName(e.target.value)}
                className="h-9 rounded-lg bg-slate-800 border border-slate-600 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 h-9 rounded-lg disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setEditing(false); setError(null) }}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-3 h-9 rounded-lg border border-slate-600"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
          </div>

          {/* Access grace period — overrides the paywall regardless of plan/trial */}
          <div className="mt-4 pt-3 border-t border-slate-600/50">
            <p className="text-xs text-slate-400 mb-2">
              Access grace period
              {graceActive
                ? <span className="text-green-300"> · active until {formatDate(graceUntil!)}</span>
                : <span className="text-slate-500"> · none</span>}
            </p>
            <div className="flex gap-2 flex-wrap items-center">
              {[7, 14, 30].map(d => (
                <button
                  key={d}
                  onClick={() => setGrace(d)}
                  disabled={savingGrace}
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 h-8 rounded-lg disabled:opacity-50"
                >
                  +{d} days
                </button>
              ))}
              {graceActive && (
                <button
                  onClick={() => setGrace(null)}
                  disabled={savingGrace}
                  className="text-xs text-rose-300 hover:text-rose-200 px-3 h-8 rounded-lg border border-rose-500/40 disabled:opacity-50"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-slate-700/50 hover:bg-slate-700/30">
      <td className="px-4 py-3 text-white">{trainer.name ?? '—'}</td>
      <td className="px-4 py-3 text-slate-300">{trainer.email}</td>
      <td className="px-4 py-3 text-slate-300">{trainer.businessName ?? '—'}</td>
      <td className="px-4 py-3">
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          trainer.subscriptionStatus === 'ACTIVE' ? 'bg-green-900 text-green-300' :
          trainer.subscriptionStatus === 'TRIALING' ? 'bg-blue-900 text-blue-300' :
          'bg-slate-700 text-slate-400'
        }`}>
          {trainer.subscriptionPlanName ?? 'No plan'} · {trainer.subscriptionStatus ?? '—'}
        </span>
        {graceActive && (
          <span className="ml-1.5 text-xs px-2 py-0.5 rounded-full bg-amber-900 text-amber-300" title={`Grace access until ${formatDate(graceUntil!)}`}>
            Grace
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-slate-300">{trainer.clientCount}</td>
      <td className="px-4 py-3">
        {(() => {
          const { onboardingCompleted: done, onboardingTotal: total } = trainer
          const pct = total > 0 ? Math.round((done / total) * 100) : 0
          const complete = total > 0 && done >= total
          return (
            <div className="flex items-center gap-2" title={`${done} of ${total} onboarding steps complete`}>
              <div className="w-14 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                <div className={`h-full ${complete ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
              </div>
              <span className={`text-xs tabular-nums ${complete ? 'text-green-300' : 'text-slate-300'}`}>{done}/{total}</span>
            </div>
          )
        })()}
      </td>
      <td className="px-4 py-3">
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 tabular-nums" title={`${trainer.onboardingEmails} onboarding email${trainer.onboardingEmails === 1 ? '' : 's'} sent`}>
          {trainer.onboardingEmails} sent
        </span>
      </td>
      <td className="px-4 py-3 text-slate-400">{formatDate(trainer.createdAt)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <a
            href={`/api/admin/impersonate/${trainer.id}`}
            className="p-1.5 text-slate-400 hover:text-green-400 rounded-lg hover:bg-slate-700 transition-colors"
            title={`Log in as ${trainer.name ?? trainer.email}`}
          >
            <LogIn className="h-3.5 w-3.5" />
          </a>
          <button
            onClick={() => setEditing(true)}
            className="p-1.5 text-slate-400 hover:text-blue-400 rounded-lg hover:bg-slate-700 transition-colors"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1.5 ml-1">
              <span className="text-xs text-red-400">Delete?</span>
              <button onClick={handleDelete} disabled={deleting} className="text-xs text-red-400 hover:text-red-300 font-medium disabled:opacity-50">
                {deleting ? '…' : 'Yes'}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-slate-500 hover:text-slate-300">No</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-700 transition-colors"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
