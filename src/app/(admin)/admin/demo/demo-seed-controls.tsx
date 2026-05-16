'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Database, Trash2 } from 'lucide-react'

type Action = 'seed' | 'reset'

// Two big buttons + a confirm prompt + a result panel. Server returns
// counts that we render verbatim so the admin can see what changed.
export function DemoSeedControls() {
  const router = useRouter()
  const [pending, setPending] = useState<Action | null>(null)
  const [confirming, setConfirming] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{ action: Action; counts: Record<string, number> } | null>(null)

  async function run(action: Action) {
    setError(null)
    setPending(action)
    setConfirming(null)
    try {
      const res = await fetch(`/api/admin/demo/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      // Read body as text first so we can show something useful even if
      // the server returned HTML (route not registered, auth redirect,
      // 500 page) instead of JSON.
      const raw = await res.text()
      let body: unknown
      try { body = JSON.parse(raw) } catch {
        const looksHtml = raw.trimStart().startsWith('<')
        setError(
          looksHtml
            ? `${action} endpoint returned HTML (${res.status}). The route /api/admin/demo/${action} probably isn't deployed yet — Vercel needs the latest build, or restart the dev server.`
            : `${action} endpoint returned non-JSON (${res.status}). First 200 chars: ${raw.slice(0, 200)}`,
        )
        return
      }
      if (!res.ok) {
        const msg = (body as { error?: string })?.error ?? `HTTP ${res.status}`
        setError(`${action} failed: ${msg}`)
        return
      }
      const result = (body as { result?: Record<string, number> }).result ?? {}
      setLastResult({ action, counts: result })
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setPending(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setConfirming('seed')}
          disabled={pending !== null}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending === 'seed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
          Seed demo data
        </button>
        <button
          type="button"
          onClick={() => setConfirming('reset')}
          disabled={pending !== null}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-700 text-white font-medium hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending === 'reset' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Reset (wipe only)
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-400">{error}</p>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setConfirming(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative z-50 bg-slate-800 border border-slate-700 rounded-2xl p-5 w-full max-w-sm text-white" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">
              {confirming === 'seed' ? 'Re-seed demo data?' : 'Wipe demo data?'}
            </h3>
            <p className="text-sm text-slate-300 mb-4">
              {confirming === 'seed'
                ? 'This deletes the demo trainer’s current records and rebuilds ~50 clients, packages, sessions, library items, products, achievements, and enquiries. Takes a few seconds.'
                : 'This deletes every client-facing record for the demo trainer — clients, dogs, packages, sessions, library, products, achievements, enquiries, forms, availability. The trainer login itself is preserved.'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => run(confirming)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  confirming === 'seed' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-red-600 hover:bg-red-500'
                }`}
              >
                {confirming === 'seed' ? 'Seed' : 'Wipe'}
              </button>
            </div>
          </div>
        </div>
      )}

      {lastResult && (
        <div className="mt-5 bg-slate-800 border border-slate-700 rounded-2xl p-4">
          <p className="text-sm font-medium text-slate-200 mb-2">
            {lastResult.action === 'seed' ? 'Seed complete' : 'Reset complete'}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
            {Object.entries(lastResult.counts).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-slate-400">{k}</span>
                <span className="tabular-nums text-slate-200">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
