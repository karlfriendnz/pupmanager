'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, ListChecks, Loader2, Sparkles } from 'lucide-react'

// The pay-off for default homework: after a session, the tasks this offering
// normally hands out are already sitting here, ticked, and go out in ONE tap
// instead of five trips through the library.
//
// Renders nothing at all when the offering has no defaults, so a session that
// was never set up looks exactly as it did before.

interface SuggestedTask {
  id: string
  title: string
  description: string | null
  repetitions: number | null
  libraryTaskId: string | null
  /** Recipients who already have this one — never offered twice. */
  assignedClientIds: string[]
}

interface Recipient {
  clientId: string
  clientName: string
  dogName: string | null
  present: boolean
}

interface Payload {
  packageId: string | null
  packageName?: string
  sessionIndex: number | null
  isGroup?: boolean
  tasks: SuggestedTask[]
  recipients: Recipient[]
}

export function SuggestedHomework({
  sessionId,
  onAssigned,
}: {
  sessionId: string
  /**
   * Fired after tasks are created, with the new rows — so the surrounding list
   * can reload, or the post-notes flow can carry them into its review step.
   */
  onAssigned?: (created: unknown[]) => void
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [chosenTasks, setChosenTasks] = useState<Set<string>>(new Set())
  const [chosenClients, setChosenClients] = useState<Set<string>>(new Set())
  const [showWho, setShowWho] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/default-homework`)
    if (!res.ok) { setData({ packageId: null, sessionIndex: null, tasks: [], recipients: [] }); return }
    const payload = (await res.json()) as Payload
    setData(payload)
    // Pre-tick everything nobody has yet, and everyone who turned up — the
    // common case is "yes, all of it, to all of them".
    setChosenTasks(new Set(payload.tasks.filter(t => t.assignedClientIds.length < payload.recipients.length).map(t => t.id)))
    setChosenClients(new Set(payload.recipients.filter(r => r.present).map(r => r.clientId)))
  }, [sessionId])

  useEffect(() => { void load() }, [load])

  if (!data || data.tasks.length === 0) return null

  const outstanding = data.tasks.filter(t => t.assignedClientIds.length < data.recipients.length)
  // Everybody already has the lot — say so once rather than offering it again.
  if (outstanding.length === 0 && done === null) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
        <Check className="h-4 w-4 flex-shrink-0 text-emerald-500" strokeWidth={2} />
        The usual homework for this session is set.
      </p>
    )
  }

  const taskCount = chosenTasks.size
  const clientCount = data.isGroup ? chosenClients.size : 1
  const canSave = taskCount > 0 && clientCount > 0 && !saving

  async function assign() {
    if (!data) return
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/sessions/${sessionId}/default-homework`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rowIds: Array.from(chosenTasks),
        ...(data.isGroup ? { clientIds: Array.from(chosenClients) } : {}),
      }),
    })
    setSaving(false)
    if (!res.ok) { setError('Could not add those. Try again.'); return }
    const payload = (await res.json()) as { created: number; tasks: unknown[] }
    setDone(payload.created)
    onAssigned?.(payload.tasks ?? [])
    void load()
  }

  if (done !== null) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <Check className="h-4 w-4 flex-shrink-0" strokeWidth={2} />
        {done === 0
          ? 'Everyone already had those.'
          : `Added ${done} ${done === 1 ? 'task' : 'tasks'}${data.isGroup ? ` across ${clientCount} ${clientCount === 1 ? 'client' : 'clients'}` : ''}.`}
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-start gap-3 px-4 py-3">
        <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">
            Usual homework{data.sessionIndex ? ` for session ${data.sessionIndex}` : ''}
          </p>
          <p className="text-xs text-slate-500">{data.packageName}</p>
        </div>
      </div>

      <div className="border-t border-slate-200">
        {outstanding.map(t => {
          const on = chosenTasks.has(t.id)
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setChosenTasks(prev => {
                const next = new Set(prev)
                if (on) next.delete(t.id); else next.add(t.id)
                return next
              })}
              aria-pressed={on}
              className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-b-0 transition-colors active:bg-slate-50"
            >
              <span
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${
                  on ? 'border-accent bg-accent text-white' : 'border-slate-300 bg-white'
                }`}
              >
                {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-900">{t.title}</span>
                {t.repetitions ? <span className="block text-xs text-slate-400">{t.repetitions} reps</span> : null}
              </span>
            </button>
          )
        })}
      </div>

      {/* Group classes go to the whole roster by default. Who is a detail, so
          it stays folded away until the trainer wants to change it. */}
      {data.isGroup && data.recipients.length > 0 && (
        <div className="border-t border-slate-200">
          <button
            type="button"
            onClick={() => setShowWho(v => !v)}
            aria-expanded={showWho}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-600 transition-colors active:bg-slate-50"
          >
            <ListChecks className="h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate">
              Going to {clientCount} of {data.recipients.length}
            </span>
            <ChevronDown className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${showWho ? 'rotate-180' : ''}`} strokeWidth={1.75} />
          </button>
          {showWho && (
            <div className="border-t border-slate-100">
              {data.recipients.map(r => {
                const on = chosenClients.has(r.clientId)
                return (
                  <button
                    key={r.clientId}
                    type="button"
                    onClick={() => setChosenClients(prev => {
                      const next = new Set(prev)
                      if (on) next.delete(r.clientId); else next.add(r.clientId)
                      return next
                    })}
                    aria-pressed={on}
                    className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-left last:border-b-0 active:bg-slate-50"
                  >
                    <span
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${
                        on ? 'border-accent bg-accent text-white' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                      {r.dogName ? `${r.dogName} · ${r.clientName}` : r.clientName}
                    </span>
                    {!r.present && <span className="flex-shrink-0 text-xs text-slate-400">Away</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {error && <p className="border-t border-slate-200 px-4 py-2 text-xs text-red-600">{error}</p>}

      <div className="border-t border-slate-200 p-3">
        <button
          type="button"
          onClick={assign}
          disabled={!canSave}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-semibold text-white transition-colors active:bg-accent-strong disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
          {taskCount === 0
            ? 'Nothing selected'
            : `Add ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}${data.isGroup ? ` to ${clientCount}` : ''}`}
        </button>
      </div>
    </div>
  )
}
