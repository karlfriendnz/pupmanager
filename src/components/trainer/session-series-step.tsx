'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, Loader2, Route } from 'lucide-react'
import { RichText } from '@/components/shared/rich-text'
import { isRichTextEmpty } from '@/lib/rich-text'

// Which curriculum step THIS session covers — shown on the session screen, and
// on a 1:1 session, changed there.
//
// Changing it is the whole point of the feature. A trainer opens the session,
// sees the dog already has recall, and moves this session on to step 3; every
// session after it shifts up, and the homework follows the step rather than the
// slot. The shifting is done server-side (lib/series.ts) so the stored answer
// and the derived one can never disagree — this only sends which step was
// picked and re-reads the result.
//
// Renders NOTHING when the offering has no curriculum, so an ordinary session
// looks exactly as it did before. On a group class it renders read-only: a
// cohort covers week N together, so there is no per-session step to move (the
// API refuses it too — see the series-step route).

interface Step {
  id: string
  sessionIndex: number
  title: string
}

interface Payload {
  isSeries: boolean
  isGroup?: boolean
  pinnable?: boolean
  packageName?: string
  position?: number | null
  total?: number
  step: (Step & { description: string | null; pinned: boolean }) | null
  steps: Step[]
}

export function SessionSeriesStep({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/series-step`)
    if (!res.ok) { setData({ isSeries: false, step: null, steps: [] }); return }
    setData((await res.json()) as Payload)
  }, [sessionId])

  useEffect(() => { void load() }, [load])

  if (!data?.isSeries) return null

  async function pick(stepId: string | null) {
    setSaving(stepId ?? 'auto')
    setError(null)
    const res = await fetch(`/api/sessions/${sessionId}/series-step`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId }),
    })
    setSaving(null)
    if (!res.ok) { setError('Could not change the step.'); return }
    setOpen(false)
    await load()
  }

  const step = data.step
  // On a consult, the slot and the step part company the moment something is
  // skipped — "session 2" covering "step 3" is the normal, correct state, so
  // both are shown rather than one being quietly relabelled as the other.
  const diverged = !data.isGroup && step != null && data.position != null && step.sessionIndex !== data.position

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-start gap-3 px-4 py-3">
        <Route className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">
            {step ? `Step ${step.sessionIndex} · ${step.title}` : 'No step for this session'}
          </p>
          <p className="text-xs text-slate-500">
            {data.packageName}
            {diverged ? ` · session ${data.position} of ${data.total}` : ''}
            {data.isGroup && data.position ? ` · week ${data.position}` : ''}
          </p>
          {/* The description is rich text now (and client-facing), so it goes
              through the shared sanitising renderer rather than being printed
              as raw characters — which would show the trainer their own markup.
              Plain-text descriptions written before that pass through unchanged. */}
          {!isRichTextEmpty(step?.description) && (
            <RichText html={step?.description} className="mt-1.5 text-sm text-slate-600" />
          )}
        </div>
        {/* A class shows its step and stops there — nothing to choose. */}
        {data.pinnable && (
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            className="flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-blue-600 transition-colors active:bg-blue-50"
          >
            Change
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {open && data.pinnable && (
        <div className="border-t border-slate-200">
          <p className="px-4 py-2 text-xs text-slate-500">
            Pick what this session actually covers. Everything after it moves up,
            so nothing gets covered twice or missed.
          </p>
          {/* Every step, including ones already covered — repeating a step for
              a dog that didn't get it is as real as skipping one. */}
          {data.steps.map(s => {
            const on = step?.id === s.id
            return (
              <button
                key={s.id}
                type="button"
                disabled={saving !== null}
                onClick={() => pick(s.id)}
                aria-pressed={on}
                className="flex w-full items-center gap-3 border-t border-slate-100 px-4 py-2.5 text-left transition-colors active:bg-slate-50 disabled:opacity-50"
              >
                <span
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${
                    on ? 'border-accent bg-accent text-white' : 'border-slate-300 bg-white'
                  }`}
                >
                  {saving === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                  <span className="text-slate-400">{s.sessionIndex}.</span> {s.title}
                </span>
              </button>
            )
          })}
          {/* Undo a pin: hand the session back to the natural order rather than
              leaving the trainer to work out which step it "should" have been. */}
          {step?.pinned && (
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => pick(null)}
              className="w-full border-t border-slate-100 px-4 py-2.5 text-left text-sm text-slate-500 transition-colors active:bg-slate-50 disabled:opacity-50"
            >
              Put back in the usual order
            </button>
          )}
        </div>
      )}

      {error && <p className="border-t border-slate-200 px-4 py-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
