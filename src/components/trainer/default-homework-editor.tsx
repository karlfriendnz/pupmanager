'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, ListChecks, Loader2, Plus, Search, Trash2 } from 'lucide-react'
import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'

// The default homework a trainer sets up on an offering: "everyone who books
// the puppy consult gets these three things after session 1".
//
// Nothing here sends anything. The list is SUGGESTED on the session screen when
// the trainer writes up their notes, and confirmed in one tap — which is the
// whole point: the same five library items, picked once instead of every time.

type Timing = 'BEFORE_SESSION' | 'AFTER_SESSION'

interface Row {
  id: string
  sessionIndex: number | null
  /** Preparation for the session, or practice after it. */
  timing: Timing
  order: number
  libraryTaskId: string | null
  title: string
  description: string | null
  repetitions: number | null
  libraryPath: string | null
}

interface LibTask { id: string; title: string; description: string | null; repetitions: number | null }
/** `tasks` on the type is the items with no theme — a theme is optional grouping. */
interface LibType { id: string; name: string; themes: { id: string; name: string; tasks: LibTask[] }[]; tasks?: LibTask[] }

/** null is the "every session" bucket; numbers are session numbers. */
type Bucket = number | null

export function DefaultHomeworkEditor({
  packageId,
  sessionCount,
  /** What one occasion is called here — "session" everywhere but events. */
  noun = 'Session',
  intro,
  stepHeader,
  everySessionLast = false,
  onlySessionIndex,
}: {
  packageId: string
  sessionCount: number
  noun?: string
  /**
   * Put the "every session" bucket at the BOTTOM. A curriculum is read as an
   * ordered list — step 1, step 2, step 3 — and an unnumbered bucket sitting
   * above step 1 breaks the count before it starts.
   */
  everySessionLast?: boolean
  /** Replaces the standard blurb, for a surface where it reads differently. */
  intro?: ReactNode
  /**
   * Extra content above each NUMBERED bucket's homework, given that bucket's
   * session number.
   *
   * This is how a SERIES curriculum is edited: the plan for a step ("session 2
   * is loose-lead walking") and the homework that follows it are the same
   * thought, and a trainer wants them on one line — but they must not become
   * two homework editors that drift apart, so the series slots its plan fields
   * into THIS one rather than growing a second copy of the library picker, the
   * fetching and the per-bucket bookkeeping.
   *
   * Never called for the "every session" bucket, which has no step behind it.
   */
  stepHeader?: (sessionIndex: number) => ReactNode
  /**
   * Render ONE bucket instead of all of them — a session number, or `null` for
   * the "every session" bucket. Omit (undefined) for the whole list.
   *
   * This is what lets a curriculum be read as a LIST OF SESSIONS you click
   * into: the list screen shows one row per session, and opening one mounts
   * this same editor scoped to that session's homework. Still one editor of
   * these rows, not a second copy — see `stepHeader`.
   *
   * A scoped render drops the offering-wide intro (the screen that sent you
   * here already said it) and labels the block "Homework", because the caller
   * has already established which session you are looking at. It also ignores
   * `sessionCount`, so a step written past the end of a shortened offering can
   * still be opened and cleared rather than being stranded out of reach.
   */
  onlySessionIndex?: Bucket
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
  const buckets: Bucket[] = useMemo(() => {
    if (onlySessionIndex !== undefined) return [onlySessionIndex]
    const numbered = Array.from({ length: Math.max(0, sessionCount) }, (_, i) => i + 1)
    return everySessionLast ? [...numbered, null] : [null, ...numbered]
  }, [sessionCount, everySessionLast, onlySessionIndex])

  const scoped = onlySessionIndex !== undefined

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

  /**
   * Flip one row between preparation and practice. Optimistic — it is a
   * two-state toggle on a row already on screen, so waiting on the round trip
   * would just make it feel broken. A failed save is put back.
   */
  async function setTiming(id: string, timing: Timing) {
    const before = rows
    setRows(prev => (prev ?? []).map(r => (r.id === id ? { ...r, timing } : r)))
    const res = await fetch(`/api/trainer/packages/${packageId}/default-homework/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timing }),
    })
    if (!res.ok) {
      setRows(before)
      setError('Could not change when that one shows.')
    }
  }

  const allLibraryTasks = useMemo(() => {
    if (!library) return [] as (LibTask & { path: string })[]
    return library.flatMap(ty => [
      ...ty.themes.flatMap(th => th.tasks.map(t => ({ ...t, path: `${ty.name} · ${th.name}` }))),
      // The loose items, shown by their category alone. Missing them here would
      // make an item impossible to set as an offering's default homework.
      ...(ty.tasks ?? []).map(t => ({ ...t, path: ty.name })),
    ])
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
      {!scoped && (intro ?? (
        <p className="text-sm leading-relaxed text-slate-500">
          The homework you normally hand out on this offering. Nothing is sent on its
          own — when you write up a session, these are waiting for you to confirm in
          one tap, and you can edit or drop any of them per client afterwards. Mark
          anything they need to do first as <em>before</em>, and it reaches them as
          soon as you hand it over rather than once the session has run.
        </p>
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {buckets.map(bucket => {
        const mine = rows
          .filter(r => r.sessionIndex === bucket)
          .sort((a, b) => a.order - b.order)
        return (
          <div key={bucket ?? 'every'}>
            {/* Scoped, the caller has already named the session it opened, so
                the plan fields come first and the label names what follows
                them. Unscoped, the number is the only thing separating one
                bucket from the next, so it leads. */}
            {scoped ? (
              <>
                {bucket !== null && stepHeader?.(bucket)}
                <SectionLabel>Homework</SectionLabel>
              </>
            ) : (
              <>
                <SectionLabel>{bucket === null ? 'Every session' : `${noun} ${bucket}`}</SectionLabel>
                {bucket !== null && stepHeader?.(bucket)}
              </>
            )}
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
                    <TimingToggle
                      value={r.timing}
                      noun={noun.toLocaleLowerCase('en-NZ')}
                      onChange={t => setTiming(r.id, t)}
                    />
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
 * When this one reaches the client: before the session, or after it.
 *
 * A two-state segment rather than a checkbox, because neither state is the
 * "off" one — "bring a hungry dog and a pot of chicken" is as deliberate a
 * choice as "practise the recall twice a day", and a lone ticked box saying
 * "before" leaves the trainer guessing what unticked means.
 */
function TimingToggle({
  value,
  noun,
  onChange,
}: {
  value: Timing
  noun: string
  onChange: (t: Timing) => void
}) {
  const options: { key: Timing; label: string }[] = [
    { key: 'BEFORE_SESSION', label: `Before the ${noun}` },
    { key: 'AFTER_SESSION', label: `After the ${noun}` },
  ]
  return (
    <div
      role="group"
      aria-label="When this shows to the client"
      className="mt-2 inline-flex rounded-lg bg-slate-100 p-0.5"
    >
      {options.map(o => {
        const on = value === o.key
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
              on ? 'bg-white font-medium text-slate-900' : 'text-slate-500 active:text-slate-700'
            }`}
          >
            {o.label}
          </button>
        )
      })}
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
    // The whole screen on a phone, a centred panel on a desktop — the shared
    // shell, so this and the attendance picker can't drift apart again.
    <FullScreenSheet
      title="Add homework"
      sub={title}
      onClose={onClose}
      headerExtra={
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-4 pb-3">
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
      }
    >
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
    </FullScreenSheet>
  )
}
