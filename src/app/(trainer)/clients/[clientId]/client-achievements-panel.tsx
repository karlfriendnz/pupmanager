'use client'

import { useEffect, useState } from 'react'
import { Trophy, Plus, Check, Loader2, X } from 'lucide-react'

type TriggerType =
  | 'MANUAL' | 'FIRST_SESSION' | 'SESSIONS_COMPLETED' | 'IN_PERSON_SESSIONS' | 'VIRTUAL_SESSIONS'
  | 'CONSECUTIVE_SESSIONS_ATTENDED' | 'FIRST_PACKAGE_ASSIGNED' | 'PACKAGES_COMPLETED'
  | 'FIRST_HOMEWORK_DONE' | 'HOMEWORK_TASKS_DONE' | 'HOMEWORK_STREAK_DAYS' | 'PERFECT_WEEK'
  | 'CLIENT_ANNIVERSARY_DAYS' | 'MESSAGES_SENT' | 'PRODUCTS_PURCHASED' | 'PROFILE_COMPLETED'

interface Row {
  id: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  triggerType: TriggerType
  triggerValue: number | null
  earned: boolean
  award: { awardedAt: string; awardedBy: string; earnedValue: number | null } | null
}

const COLOR_BY_KEY: Record<string, { bgChip: string; ring: string; text: string }> = {
  blue:    { bgChip: 'bg-blue-100 text-blue-600',       ring: 'ring-blue-200',    text: 'text-blue-700' },
  emerald: { bgChip: 'bg-emerald-100 text-emerald-600', ring: 'ring-emerald-200', text: 'text-emerald-700' },
  amber:   { bgChip: 'bg-amber-100 text-amber-600',     ring: 'ring-amber-200',   text: 'text-amber-700' },
  rose:    { bgChip: 'bg-rose-100 text-rose-600',       ring: 'ring-rose-200',    text: 'text-rose-700' },
  violet:  { bgChip: 'bg-violet-100 text-violet-600',   ring: 'ring-violet-200',  text: 'text-violet-700' },
  sky:     { bgChip: 'bg-sky-100 text-sky-600',         ring: 'ring-sky-200',     text: 'text-sky-700' },
  orange:  { bgChip: 'bg-orange-100 text-orange-600',   ring: 'ring-orange-200',  text: 'text-orange-700' },
  teal:    { bgChip: 'bg-teal-100 text-teal-600',       ring: 'ring-teal-200',    text: 'text-teal-700' },
  pink:    { bgChip: 'bg-pink-100 text-pink-600',       ring: 'ring-pink-200',    text: 'text-pink-700' },
  slate:   { bgChip: 'bg-slate-200 text-slate-600',     ring: 'ring-slate-200',   text: 'text-slate-700' },
}

function tone(color: string | null) {
  return COLOR_BY_KEY[color ?? 'amber'] ?? COLOR_BY_KEY.amber
}

function triggerSummary(t: TriggerType, v: number | null): string {
  switch (t) {
    case 'MANUAL': return 'Manual'
    case 'FIRST_SESSION': return 'First completed session'
    case 'SESSIONS_COMPLETED': return `${v} sessions`
    case 'IN_PERSON_SESSIONS': return `${v} in-person sessions`
    case 'VIRTUAL_SESSIONS': return `${v} virtual sessions`
    case 'CONSECUTIVE_SESSIONS_ATTENDED': return `${v} sessions in a row`
    case 'FIRST_PACKAGE_ASSIGNED': return 'First package'
    case 'PACKAGES_COMPLETED': return `${v} packages completed`
    case 'FIRST_HOMEWORK_DONE': return 'First homework done'
    case 'HOMEWORK_TASKS_DONE': return `${v} homework tasks`
    case 'HOMEWORK_STREAK_DAYS': return `${v}-day streak`
    case 'PERFECT_WEEK': return `${v} perfect weeks`
    case 'CLIENT_ANNIVERSARY_DAYS': return `${v} days as a client`
    case 'MESSAGES_SENT': return `${v} messages sent`
    case 'PRODUCTS_PURCHASED': return `${v} products bought`
    case 'PROFILE_COMPLETED': return 'Profile fully filled'
  }
}

export function ClientAchievementsPanel({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/clients/${clientId}/achievements`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setRows(data.achievements ?? []) })
      .catch(() => { if (!cancelled) setError('Failed to load achievements') })
    return () => { cancelled = true }
  }, [clientId])

  async function award(achievementId: string) {
    setBusyId(achievementId)
    try {
      const res = await fetch(`/api/clients/${clientId}/achievements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ achievementId }),
      })
      if (!res.ok) throw new Error('Failed')
      setRows(prev => prev ? prev.map(r => r.id === achievementId ? { ...r, earned: true, award: { awardedAt: new Date().toISOString(), awardedBy: 'manual', earnedValue: null } } : r) : prev)
    } catch {
      setError('Could not award')
    } finally {
      setBusyId(null)
    }
  }

  async function revoke(achievementId: string) {
    if (!confirm('Revoke this achievement?')) return
    setBusyId(achievementId)
    try {
      const res = await fetch(`/api/clients/${clientId}/achievements/${achievementId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`DELETE ${res.status}`)
      setRows(prev => prev ? prev.map(r => r.id === achievementId ? { ...r, earned: false, award: null } : r) : prev)
    } catch (err) {
      // Server-first: don't drop the row locally if the DB still has the
      // award. Surface the error so the trainer knows the revoke didn't
      // stick instead of seeing it reappear after a refresh.
      console.error('[client-achievements] revoke failed', err)
      setError('Could not revoke — try again')
    } finally {
      setBusyId(null)
    }
  }

  if (!rows) {
    return <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
  }
  if (error) {
    return <p className="text-sm text-red-600">{error}</p>
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-white p-6 text-center">
        <div className="h-12 w-12 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto">
          <Trophy className="h-5 w-5 text-amber-500" />
        </div>
        <p className="mt-3 text-sm font-medium text-slate-700">No achievements set up yet</p>
        <p className="mt-1 text-xs text-slate-500 max-w-xs mx-auto">
          Build your catalogue from the Achievements page in the sidebar — they&apos;ll show up here once defined.
        </p>
      </div>
    )
  }

  const earned = rows.filter(r => r.earned)
  const remaining = rows.filter(r => !r.earned)

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Earned ({earned.length})
        </h3>
        {earned.length === 0 ? (
          <p className="text-xs text-slate-400 italic">None yet — auto-rules will fire as the client progresses.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {earned.map(r => {
              const t = tone(r.color)
              return (
                <li key={r.id} className={`rounded-2xl bg-white border border-slate-100 shadow-sm p-3 ring-1 ${t.ring} flex items-center gap-3`}>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl ${t.bgChip} shrink-0`}>
                    {r.icon || '🏆'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{r.name}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {r.award?.earnedValue != null
                        ? `${triggerSummary(r.triggerType, r.award.earnedValue)} · ${new Date(r.award.awardedAt).toLocaleDateString()}`
                        : new Date(r.award?.awardedAt ?? Date.now()).toLocaleDateString()}
                    </p>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => revoke(r.id)}
                      disabled={busyId === r.id}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                      title="Revoke"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {remaining.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Not yet earned
          </h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {remaining.map(r => {
              const t = tone(r.color)
              const isManual = r.triggerType === 'MANUAL'
              return (
                <li key={r.id} className="rounded-2xl bg-white border border-slate-100 p-3 flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl ${t.bgChip} shrink-0 grayscale opacity-60`}>
                    {r.icon || '🏆'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{r.name}</p>
                    <p className="text-[11px] text-slate-400 truncate">{triggerSummary(r.triggerType, r.triggerValue)}</p>
                  </div>
                  {canEdit && isManual && (
                    <button
                      onClick={() => award(r.id)}
                      disabled={busyId === r.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
                    >
                      {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                      Award
                    </button>
                  )}
                  {!isManual && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-slate-500 bg-slate-100">
                      <Check className="h-3 w-3" /> Auto
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
