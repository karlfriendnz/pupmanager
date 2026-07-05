'use client'

import { useState } from 'react'
import { Loader2, UserCog } from 'lucide-react'

interface MemberOption {
  id: string
  name: string
  role: string
}

// Compact "assigned trainer" picker shown on the client profile for
// multi-trainer businesses. Persists immediately via PATCH /api/clients/[id].
export function AssignedTrainerControl({
  clientId,
  members,
  initialMembershipId,
}: {
  clientId: string
  members: MemberOption[]
  initialMembershipId: string | null
}) {
  const [value, setValue] = useState(initialMembershipId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(next: string) {
    const prev = value
    setValue(next)
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedMembershipId: next || null }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not update')
    } catch (e) {
      setValue(prev)
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <UserCog className="h-3.5 w-3.5" /> Managed by
      </span>
      <select
        data-testid="assigned-trainer-select"
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={saving}
        className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}{m.role === 'OWNER' ? ' (owner)' : ''}
          </option>
        ))}
      </select>
      {saving && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  )
}
