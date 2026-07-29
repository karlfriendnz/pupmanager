'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ListChecks, Loader2, Plus, Search, Trash2, X } from 'lucide-react'
import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'
import { ModalPortal } from '@/components/shared/modal-portal'

// The default homework a trainer sets up on an offering: "everyone who books
// the puppy consult gets these three things after session 1".
//
// Nothing here sends anything. The list is SUGGESTED on the session screen when
// the trainer writes up their notes, and confirmed in one tap — which is the
// whole point: the same five library items, picked once instead of every time.

interface Row {
  id: string
  sessionIndex: number | null
  order: number
  libraryTaskId: string | null
  title: string
  description: string | null
  repetitions: number | null
  libraryPath: string | null
}

interface LibTask { id: string; title: string; description: string | null; repetitions: number | null }
interface LibType { id: string; name: string; themes: { id: string; name: string; tasks: LibTask[] }[] }

/** null is the "every session" bucket; numbers are session numbers. */
type Bucket = number | null

export function DefaultHomeworkEditor({
  packageId,
  sessionCount,
  /** What one occasion is called here — "session" everywhere but events. */
  noun = 'Session',
}: {
  packageId: string
  sessionCount: number
  noun?: string
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [library, setLibrary] = useState<LibType[] | null>(null)
  const [picking, setPicking] = useState<Bucket | 'closed'>('closed')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/trainer/packages/${packageId}/default-homework`)
    if (!res.ok) { setRows([]); return }
    const payload = (await res.json()) as Row[]
    setRows(payload)
  }, [packageId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    fetch('/api/library/types')
      .then(r => (r.ok ? r.json() : []))
      .then((d: unknown) => setLibrary(Array.isArray(d) ? (d as LibType[]) : []))
      .catch(() => setLibrary([]))
  }, [])

  // An ongoing offering (sessionCount 0) has no session numbers to hang things
  // off, so it only gets the "every session" bucket.
  const buckets: Bucket[] = useMemo(
    () => [null, ...Array.from({ length: Math.max(0, sessionCount) }, (_, i) => i + 1)],
    [sessionCount],
  )

  async function add(bucket: Bucket, task: LibTask) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/trainer/packages/${packageId}/default-homework`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIndex: bucket, libraryTaskId: task.id }),
    })
    setBusy(false)
    if (!res.ok) { setError('Could not add that one.'); return }
    await load()
  }

  async function remove(id: string) {
    setRows(prev => (prev ?? []).filter(r => r.id !== id))
    await fetch(`/api/trainer/packages/${packageId}/default-homework/${id}`, { method: 'DELETE' })
  }

  const allLibraryTasks = useMemo(() => {
    if (!library) return [] as (LibTask & { path: string })[]
    return library.flatMap(ty => ty.themes.flatMap(th => th.tasks.map(t => ({ ...t, path: `${ty.name} · ${th.name}` }))))
  }, [library])

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm leading-relaxed text-slate-500">
        The homework you normally hand out on this offering. Nothing is sent on its
        own — when you write up a session, these are waiting for you to confirm in
        one tap, and you can edit or drop any of them per client afterwards.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {buckets.map(bucket => {
        const mine = rows
          .filter(r => r.sessionIndex === bucket)
          .sort((a, b) => a.order - b.order)
        return (
          <div key={bucket ?? 'every'}>
            <SectionLabel>{bucket === null ? 'Every session' : `${noun} ${bucket}`}</SectionLabel>
            <FlatBlock>
              {mine.map(r => (
                <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                  <ListChecks className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{r.title}</p>
                    <p className="truncate text-xs text-slate-400">
                      {r.libraryPath ?? 'One-off'}
                      {r.repetitions ? ` · ${r.repetitions} reps` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    aria-label={`Remove ${r.title}`}
                    className="-m-1.5 flex-shrink-0 rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setPicking(bucket)}
                className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-slate-700 transition-colors active:bg-slate-50"
              >
                <Plus className="h-4 w-4 text-slate-400" strokeWidth={1.75} />
                {mine.length === 0 ? 'Add homework' : 'Add another'}
              </button>
            </FlatBlock>
          </div>
        )
      })}

      {picking !== 'closed' && (
        <LibraryPicker
          title={picking === null ? 'Every session' : `${noun} ${picking}`}
          tasks={allLibraryTasks}
          chosenIds={new Set(rows.filter(r => r.sessionIndex === picking).map(r => r.libraryTaskId).filter((v): v is string => !!v))}
          busy={busy}
          onPick={t => add(picking, t)}
          onClose={() => setPicking('closed')}
        />
      )}
    </div>
  )
}

/**
 * Full screen, not a dropdown — a trainer's library runs to dozens of items and
 * a 56px menu can't show them. Locks body scroll while it's open so there is
 * never a second scrollbar behind it.
 */
function LibraryPicker({
  title,
  tasks,
  chosenIds,
  busy,
  onPick,
  onClose,
}: {
  title: string
  tasks: (LibTask & { path: string })[]
  chosenIds: Set<string>
  busy: boolean
  onPick: (t: LibTask) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set())

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('en-NZ')
    if (!q) return tasks
    return tasks.filter(t =>
      t.title.toLocaleLowerCase('en-NZ').includes(q) || t.path.toLocaleLowerCase('en-NZ').includes(q),
    )
  }, [tasks, search])

  return (
    <ModalPortal>
      <div role="dialog" aria-modal="true" aria-label={`Add homework to ${title}`} className="fixed inset-0 z-[90] flex flex-col bg-slate-50">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 pt-[env(safe-area-inset-top)]">
          <div className="min-w-0 flex-1 py-3.5">
            <p className="truncate text-[15px] font-semibold text-slate-900">Add homework</p>
            <p className="truncate text-xs text-slate-500">{title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 flex-shrink-0 p-2 text-slate-400 active:text-slate-700">
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="border-b border-slate-200 bg-white px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={1.75} />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search your library…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto p-4">
          <div className="mx-auto w-full max-w-lg">
            {tasks.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Nothing in your library yet. Add some in <a href="/library" className="font-medium text-accent">Library</a>.
              </p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No matches.</p>
            ) : (
              <FlatBlock>
                {filtered.map(t => {
                  const already = chosenIds.has(t.id) || justAdded.has(t.id)
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={already || busy}
                      onClick={() => { setJustAdded(prev => new Set(prev).add(t.id)); onPick(t) }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-slate-50 disabled:opacity-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{t.title}</span>
                        <span className="block truncate text-xs text-slate-400">
                          {t.path}{t.repetitions ? ` · ${t.repetitions} reps` : ''}
                        </span>
                      </span>
                      {already
                        ? <Check className="h-4 w-4 flex-shrink-0 text-emerald-500" strokeWidth={2} />
                        : <Plus className="h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />}
                    </button>
                  )
                })}
              </FlatBlock>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
