'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function StatusToggle({ clientId, initialStatus }: { clientId: string; initialStatus: string }) {
  const router = useRouter()
  const [status, setStatus] = useState(initialStatus)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    // NEW → ACTIVE; ACTIVE ↔ INACTIVE
    const next = status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    setLoading(true)
    await fetch(`/api/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    setStatus(next)
    setLoading(false)
    router.refresh()
  }

  const colors =
    status === 'NEW'
      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
      : status === 'ACTIVE'
      ? 'bg-green-100 text-green-700 hover:bg-green-200'
      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'

  const dot =
    status === 'NEW'
      ? 'bg-amber-400'
      : status === 'ACTIVE'
      ? 'bg-green-500'
      : 'bg-slate-400'

  const label =
    loading ? '...' : status === 'NEW' ? 'New — click to activate' : status === 'ACTIVE' ? 'Active' : 'Inactive'

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${colors}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </button>
  )
}
