'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Sparkles } from 'lucide-react'

interface Client {
  id: string
  user: { name: string | null; email: string | null }
  dog: { name: string } | null
}

export function AIProgressSummary({ clients }: { clients: Client[] }) {
  const [clientId, setClientId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ summary: string; stats: { totalTasks: number; completedTasks: number; completionRate: number } } | null>(null)

  async function generate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    setLoading(true)
    try {
      const res = await fetch('/api/ai/summarise-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to generate summary.'); return }
      setResult(data)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={generate} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Client</label>
          <select
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            required
            className="h-12 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a client…</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>
                {c.user.name ?? c.user.email}{c.dog ? ` · ${c.dog.name}` : ''}
              </option>
            ))}
          </select>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <Button type="submit" loading={loading} className="w-full">
          <Sparkles className="h-4 w-4" />
          {loading ? 'Summarising…' : 'Generate progress summary'}
        </Button>
      </form>

      {result && (
        <div className="flex flex-col gap-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-2xl font-bold text-slate-900">{result.stats.totalTasks}</p>
              <p className="text-xs text-slate-500 mt-0.5">Tasks assigned</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{result.stats.completedTasks}</p>
              <p className="text-xs text-slate-500 mt-0.5">Completed</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{result.stats.completionRate}%</p>
              <p className="text-xs text-slate-500 mt-0.5">Rate</p>
            </div>
          </div>

          {/* AI Summary */}
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">AI Summary</p>
            </div>
            <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{result.summary}</p>
          </div>
        </div>
      )}
    </div>
  )
}
