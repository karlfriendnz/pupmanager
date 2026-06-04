'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Pause, Play } from 'lucide-react'
import { formatDate } from '@/lib/utils'

type PromoCode = {
  id: string
  code: string
  trialDays: number
  expiresAt: Date | string | null
  maxRedemptions: number | null
  redeemedCount: number
  isActive: boolean
  createdAt: Date | string
}

// Create form — sits above the table.
export function PromoCodeCreate() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [trialDays, setTrialDays] = useState('30')
  const [expiresAt, setExpiresAt] = useState('')
  const [maxRedemptions, setMaxRedemptions] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const res = await fetch('/api/admin/promo-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code.trim(),
        trialDays: Number(trialDays),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
      }),
    })
    if (res.ok) {
      setCode(''); setTrialDays('30'); setExpiresAt(''); setMaxRedemptions('')
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(typeof data.error === 'string' ? data.error : 'Could not create code')
    }
    setSaving(false)
  }

  return (
    <form onSubmit={handleCreate} className="bg-slate-800 border border-slate-700 rounded-2xl p-5 mb-6">
      <h2 className="font-semibold text-slate-200 mb-4">New promo code</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate-400">Code</span>
          <input
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="LAUNCH"
            required
            className="h-10 rounded-lg bg-slate-900 border border-slate-700 px-3 text-sm text-white uppercase placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate-400">Trial length (days)</span>
          <input
            type="number" min={1} max={3650}
            value={trialDays}
            onChange={e => setTrialDays(e.target.value)}
            required
            className="h-10 rounded-lg bg-slate-900 border border-slate-700 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate-400">Expires <span className="text-slate-500">(optional)</span></span>
          <input
            type="date"
            value={expiresAt}
            onChange={e => setExpiresAt(e.target.value)}
            className="h-10 rounded-lg bg-slate-900 border border-slate-700 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate-400">Max uses <span className="text-slate-500">(optional)</span></span>
          <input
            type="number" min={1}
            value={maxRedemptions}
            onChange={e => setMaxRedemptions(e.target.value)}
            placeholder="Unlimited"
            className="h-10 rounded-lg bg-slate-900 border border-slate-700 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-medium text-white transition disabled:opacity-60"
        >
          {saving ? 'Creating…' : 'Create code'}
        </button>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </form>
  )
}

// One table row with pause/activate + delete actions. `now` is passed from the
// server (ms epoch) so the render stays pure — no Date.now() during render.
export function PromoCodeRow({ promo, now }: { promo: PromoCode; now: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const expires = promo.expiresAt ? new Date(promo.expiresAt) : null
  const expired = !!expires && expires.getTime() <= now
  const fullyRedeemed = promo.maxRedemptions != null && promo.redeemedCount >= promo.maxRedemptions
  const live = promo.isActive && !expired && !fullyRedeemed

  async function toggleActive() {
    setBusy(true)
    const res = await fetch(`/api/admin/promo-codes/${promo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !promo.isActive }),
    })
    if (res.ok) router.refresh()
    setBusy(false)
  }

  async function handleDelete() {
    setBusy(true)
    const res = await fetch(`/api/admin/promo-codes/${promo.id}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
    setBusy(false)
    setConfirmDelete(false)
  }

  return (
    <tr className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
      <td className="px-4 py-3 font-mono text-white">{promo.code}</td>
      <td className="px-4 py-3 text-slate-300">{promo.trialDays}-day trial</td>
      <td className="px-4 py-3 text-slate-300 tabular-nums">
        {promo.redeemedCount}{promo.maxRedemptions != null ? ` / ${promo.maxRedemptions}` : ''}
      </td>
      <td className="px-4 py-3 text-slate-400">{expires ? formatDate(expires) : 'Never'}</td>
      <td className="px-4 py-3">
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          live ? 'bg-green-900 text-green-300'
            : !promo.isActive ? 'bg-slate-700 text-slate-400'
            : 'bg-amber-900 text-amber-300'
        }`}>
          {live ? 'Active' : !promo.isActive ? 'Paused' : expired ? 'Expired' : 'Used up'}
        </span>
      </td>
      <td className="px-4 py-3 text-slate-400">{formatDate(new Date(promo.createdAt))}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={toggleActive}
            disabled={busy}
            title={promo.isActive ? 'Pause' : 'Activate'}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {promo.isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          {confirmDelete ? (
            <span className="flex items-center gap-1">
              <button onClick={handleDelete} disabled={busy} className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white">Delete</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300">Cancel</button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete"
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
