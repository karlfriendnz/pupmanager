'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Check, Plus, Search, Loader2, ChevronLeft, ChevronRight, X, Minus, Repeat,
} from 'lucide-react'
import { VoiceInput } from '@/components/voice-input'
import { ImageUploadButton, ImageGallery } from '@/components/image-uploader'

// Post-save homework flow, shown after the trainer saves the session notes.
// Fully fullscreen, screen-by-screen:
//   1. pick    — auto-open library list; tapping + attaches a task and shows a
//                green tick. A full-width "Add custom task" opens its own screen.
//   2. custom  — fullscreen form for a one-off custom task.
//   3. review  — one fullscreen screen PER added task to fine-tune its details
//                (reps, note, photos) before finishing.

interface LibTask { id: string; title: string; description: string | null; repetitions: number | null; videoUrl: string | null }
interface LibType { id: string; name: string; themes: { id: string; name: string; tasks: LibTask[] }[] }
interface AddedTask {
  id: string
  title: string
  description: string | null
  repetitions: number | null
  trainerNote: string
  imageUrls: string[]
}

function coerce(raw: unknown): AddedTask {
  const t = (raw ?? {}) as Record<string, unknown>
  return {
    id: String(t.id ?? ''),
    title: String(t.title ?? ''),
    description: (t.description as string | null) ?? null,
    repetitions: (t.repetitions as number | null) ?? null,
    trainerNote: (t.trainerNote as string | null) ?? '',
    imageUrls: Array.isArray(t.imageUrls) ? (t.imageUrls as string[]) : [],
  }
}

type Screen = 'pick' | 'custom' | 'review'

export function HomeworkFlow({
  sessionId,
  clientId,
  sessionDate,
  onDone,
}: {
  sessionId: string
  clientId: string | null
  sessionDate: string
  onDone: () => void
}) {
  const [screen, setScreen] = useState<Screen>('pick')
  const [reviewIndex, setReviewIndex] = useState(0)
  const [library, setLibrary] = useState<LibType[] | null>(null)
  const [added, setAdded] = useState<AddedTask[]>([])
  const [addedLibIds, setAddedLibIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/library/types')
      .then(r => (r.ok ? r.json() : []))
      .then((data: unknown) => setLibrary(Array.isArray(data) ? (data as LibType[]) : []))
      .catch(() => setLibrary([]))
  }, [])

  const allTasks = useMemo(() => {
    if (!library) return [] as (LibTask & { typeName: string; themeName: string })[]
    return library.flatMap(ty => ty.themes.flatMap(th => th.tasks.map(t => ({ ...t, typeName: ty.name, themeName: th.name }))))
  }, [library])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allTasks
    return allTasks.filter(t => t.title.toLowerCase().includes(q) || t.themeName.toLowerCase().includes(q) || t.typeName.toLowerCase().includes(q))
  }, [allTasks, search])

  async function addLibrary(t: LibTask) {
    if (!clientId || addingId) return
    setError(null)
    setAddingId(t.id)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, sessionId, date: sessionDate, title: t.title, description: t.description, repetitions: t.repetitions, videoUrl: t.videoUrl }),
      })
      if (!res.ok) { setError('Could not add that task.'); return }
      const created = coerce(await res.json())
      setAdded(prev => [...prev, created])
      setAddedLibIds(prev => new Set(prev).add(t.id))
    } finally {
      setAddingId(null)
    }
  }

  // The library's themes, flattened for the "save to my library" picker.
  const themes = useMemo(
    () => (library ?? []).flatMap(ty => ty.themes.map(th => ({ id: th.id, label: `${ty.name} · ${th.name}` }))),
    [library],
  )

  async function addCustom(data: { title: string; description: string; repetitions: number | null; libraryThemeId?: string }) {
    if (!clientId) return false
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, sessionId, date: sessionDate, title: data.title, description: data.description || null, repetitions: data.repetitions }),
    })
    if (!res.ok) return false
    const created = coerce(await res.json())
    setAdded(prev => [...prev, created])
    // Optionally also save it as a reusable library task under the chosen theme.
    if (data.libraryThemeId) {
      void fetch('/api/library/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themeId: data.libraryThemeId, title: data.title, description: data.description || null, repetitions: data.repetitions }),
      })
    }
    return true
  }

  function patchTask(id: string, body: Record<string, unknown>) {
    void fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }
  function updateAdded(id: string, patch: Partial<AddedTask>) {
    setAdded(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
  }

  // ── CUSTOM TASK SCREEN ──────────────────────────────────────────────────
  if (screen === 'custom') {
    return <CustomTaskScreen themes={themes} onBack={() => setScreen('pick')} onAdd={async d => { const ok = await addCustom(d); if (ok) setScreen('pick'); return ok }} />
  }

  // ── REVIEW SCREEN (one per added task) ──────────────────────────────────
  if (screen === 'review' && added.length > 0) {
    const task = added[Math.min(reviewIndex, added.length - 1)]
    const isLast = reviewIndex >= added.length - 1
    return (
      <Shell
        title={`Homework ${reviewIndex + 1} of ${added.length}`}
        onClose={onDone}
        footer={
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => (reviewIndex === 0 ? setScreen('pick') : setReviewIndex(reviewIndex - 1))}
              className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
            {isLast ? (
              <button type="button" onClick={onDone} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-6 h-11">
                <Check className="h-4 w-4" /> Done
              </button>
            ) : (
              <button type="button" onClick={() => setReviewIndex(reviewIndex + 1)} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-6 h-11">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        }
      >
        <h2 className="text-2xl font-bold leading-tight text-slate-900">{task.title}</h2>
        {task.description && <p className="mt-1.5 text-sm text-slate-500 whitespace-pre-wrap">{task.description}</p>}

        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Repetitions</p>
          <RepsStepper
            value={task.repetitions}
            onChange={reps => { updateAdded(task.id, { repetitions: reps }); patchTask(task.id, { repetitions: reps }) }}
          />
        </div>

        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Note for the client</p>
          <textarea
            value={task.trainerNote}
            onChange={e => updateAdded(task.id, { trainerNote: e.target.value })}
            onBlur={e => patchTask(task.id, { trainerNote: e.target.value })}
            placeholder="Start writing…"
            className="min-h-[24vh] w-full resize-none border-0 bg-transparent p-0 text-lg leading-relaxed text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-0"
          />
          <div className="mt-1 flex items-center gap-2">
            <VoiceInput onAppend={t => { const merged = task.trainerNote ? `${task.trainerNote.trimEnd()} ${t}` : t; updateAdded(task.id, { trainerNote: merged }); patchTask(task.id, { trainerNote: merged }) }} />
          </div>
        </div>

        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Photos</p>
          <ImageUploadButton onUploaded={added2 => { const urls = [...task.imageUrls, ...added2]; updateAdded(task.id, { imageUrls: urls }); patchTask(task.id, { imageUrls: urls }) }} context={{ sessionId }} />
          <ImageGallery urls={task.imageUrls} onChange={urls => { updateAdded(task.id, { imageUrls: urls }); patchTask(task.id, { imageUrls: urls }) }} className="mt-2" />
        </div>
      </Shell>
    )
  }

  // ── PICK SCREEN ─────────────────────────────────────────────────────────
  return (
    <Shell
      title="Notes saved — add homework"
      titleIcon={<span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check className="h-4 w-4" /></span>}
      onClose={onDone}
      closeLabel="Skip"
      footer={
        <div className="flex items-center justify-end">
          {added.length > 0 ? (
            <button type="button" onClick={() => { setReviewIndex(0); setScreen('review') }} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-6 h-11">
              Review {added.length} {added.length === 1 ? 'task' : 'tasks'} <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" onClick={onDone} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-6 h-11">Done</button>
          )}
        </div>
      }
    >
      <h2 className="text-xl font-bold text-slate-900">Set homework for this lesson</h2>
      <p className="text-sm text-slate-500 mt-1">Tap a task to add it. Fine-tune the details next.</p>

      <button
        type="button"
        onClick={() => setScreen('custom')}
        disabled={!clientId}
        className="mt-5 flex w-full items-center justify-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-40 px-3 py-2.5 rounded-xl hover:bg-blue-50 border border-blue-200 transition-colors"
      >
        <Plus className="h-4 w-4" /> Add custom task
      </button>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      {library === null ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading library…</div>
      ) : allTasks.length === 0 ? (
        <p className="mt-5 text-sm text-slate-400">No library tasks yet. Add some in <a href="/templates" className="text-blue-600 hover:underline">Library</a>.</p>
      ) : (
        <>
          <div className="relative mt-5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search library tasks…" className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="mt-3 border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
            {filtered.length === 0 ? (
              <p className="text-sm text-slate-400 px-3 py-3">{search ? 'No matches.' : 'No library tasks.'}</p>
            ) : filtered.map(t => {
              const isAdded = addedLibIds.has(t.id)
              return (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{t.title}</p>
                    <p className="text-[10px] text-slate-400 truncate">{t.typeName} · {t.themeName}{t.repetitions ? ` · ${t.repetitions} reps` : ''}</p>
                  </div>
                  <button
                    onClick={() => addLibrary(t)}
                    disabled={isAdded || addingId === t.id || !clientId}
                    className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center transition-colors ${isAdded ? 'bg-emerald-500 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-40'}`}
                    title={isAdded ? 'Added' : 'Add to lesson'}
                  >
                    {addingId === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : isAdded ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </Shell>
  )
}

// Shared fullscreen chrome — top bar + scroll body + footer, safe-area aware.
function Shell({
  title, titleIcon, onClose, closeLabel, footer, children,
}: {
  title: string
  titleIcon?: React.ReactNode
  onClose: () => void
  closeLabel?: string
  footer: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-white">
      <div className="flex items-center gap-2 px-3 sm:px-5 min-h-[3.5rem] border-b border-slate-100 flex-shrink-0" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        {titleIcon ?? (
          <button type="button" onClick={onClose} className="p-2 -ml-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        )}
        <p className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-900">{title}</p>
        {closeLabel && (
          <button type="button" onClick={onClose} className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-2.5 py-1.5 rounded-lg hover:bg-slate-100">{closeLabel}</button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-5 sm:px-6 py-6">{children}</div>
      </div>
      <div className="border-t border-slate-100 flex-shrink-0 bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="mx-auto w-full max-w-2xl px-6 py-3.5">{footer}</div>
      </div>
    </div>
  )
}

function RepsStepper({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const n = value ?? 0
  return (
    <div className="inline-flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
      <Repeat className="h-4 w-4 text-slate-400" />
      <button type="button" onClick={() => onChange(n > 0 ? n - 1 : null)} disabled={n <= 0} className="h-8 w-8 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 flex items-center justify-center"><Minus className="h-4 w-4" /></button>
      <span className="min-w-[2.5rem] text-center text-base font-semibold tabular-nums text-slate-900">{value == null ? '—' : value}</span>
      <button type="button" onClick={() => onChange(n + 1)} className="h-8 w-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center"><Plus className="h-4 w-4" /></button>
      <span className="text-xs text-slate-400">reps</span>
    </div>
  )
}

function CustomTaskScreen({
  themes, onBack, onAdd,
}: {
  themes: { id: string; label: string }[]
  onBack: () => void
  onAdd: (d: { title: string; description: string; repetitions: number | null; libraryThemeId?: string }) => Promise<boolean>
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [reps, setReps] = useState<number | null>(null)
  const [saveToLibrary, setSaveToLibrary] = useState(false)
  const [themeId, setThemeId] = useState(themes[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (title.trim().length < 2) { setError('Give the task a title.'); return }
    setSaving(true); setError(null)
    const ok = await onAdd({
      title: title.trim(),
      description: description.trim(),
      repetitions: reps,
      libraryThemeId: saveToLibrary && themeId ? themeId : undefined,
    })
    if (!ok) { setError('Could not add the task.'); setSaving(false) }
    // on success the parent switches back to the pick screen (this unmounts)
  }

  return (
    <Shell
      title="New custom task"
      onClose={onBack}
      footer={
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"><ChevronLeft className="h-4 w-4" /> Back</button>
          <button type="button" onClick={submit} disabled={saving} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-6 h-11 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add task
          </button>
        </div>
      }
    >
      <h2 className="text-xl font-bold text-slate-900">Create a custom task</h2>
      <p className="text-sm text-slate-500 mt-1">A one-off homework task just for this client.</p>

      <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-slate-400">Title</label>
      <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="e.g. Loose-lead walking" className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

      <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-slate-400">Description</label>
      <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} placeholder="What should they practise?" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />

      <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-slate-400">Repetitions</label>
      <div className="mt-2"><RepsStepper value={reps} onChange={setReps} /></div>

      {/* Optionally also save this as a reusable library task. */}
      {themes.length > 0 && (
        <div className="mt-6 rounded-xl border border-slate-200 p-3.5">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={saveToLibrary} onChange={e => setSaveToLibrary(e.target.checked)} className="h-4 w-4 mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-slate-700 leading-snug">
              Also save to my library
              <span className="block text-[11px] text-slate-400 mt-0.5">Reuse this task for other clients later.</span>
            </span>
          </label>
          {saveToLibrary && (
            <select value={themeId} onChange={e => setThemeId(e.target.value)} className="mt-3 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {themes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
    </Shell>
  )
}
