'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, ClipboardCheck, Eye, Lock, Plus, Repeat } from 'lucide-react'
import { ConfirmSheet } from '@/components/shared/confirm-sheet'
import { FlatBlock } from '@/components/shared/flat-list'
import { SortableOfferingCard, SortableOfferingList } from '@/components/shared/offering-card'
import { DefaultHomeworkEditor } from '@/components/trainer/default-homework-editor'
import { RichTextEditor } from '@/components/shared/rich-text-editor'

// The curriculum of a SERIES — what happens in each session, defined up front.
//
// A LIST OF SESSIONS you click into. Session 1…6 are there the moment the
// offering has more than one session, whether or not anything has been written
// yet: you open the one you want and write its description and its homework on
// a screen of their own. That is what makes the offering a series — there is no
// "add a step" action to find first, and no empty rows are created to fill the
// list.
//
// It was one long stack: every session's plan and homework on one page, all
// expanded. That reads fine at three sessions and not at all at ten, and it
// buried the thing a trainer actually came to do — write up ONE session.
//
// Sessions and the homework that follows them stay one thought, so this does
// NOT own a homework editor. It renders `DefaultHomeworkEditor` — the same one
// the consult and class Homework tabs use, with the same library picker and the
// same API — scoped to one session with `onlySessionIndex`, and passes its plan
// fields down through that component's `stepHeader` slot. Two editors would
// have to be kept in step by hand, and would key off the same session number
// from two places.
//
// A single-session offering keeps the old flat layout: one session is not a
// list, and there is nothing to arrange.
//
// One editor for a class AND a consult, for the same reason: the curriculum
// lives on the Package, which is the template behind both. Only the sentence
// explaining how the sessions get booked differs, so only that is a prop.
//
// THE SCHEDULED SESSIONS LIVE HERE TOO. A class used to list its booked dates
// on the Details tab and its curriculum here, which meant two lists of the same
// six sessions on two different tabs — the trainer had to hold "week 3" in their
// head to cross one against the other. `scheduledSessions` merges the diary into
// this list: one row per session carrying its number, its date, its step and its
// homework count, opening the plan on click and the session screen on the link.
// It is OPTIONAL because a 1:1 package has no run and therefore no dates, and
// the editor has to work exactly as it did without them.
//
// THE LIST DRAGS INTO ORDER. A curriculum is written once and then rethought —
// "actually, do loose-lead first" — and doing that by retyping six plans and
// re-picking their homework is how a trainer decides not to bother. Dragging a
// row moves its plan AND its homework together, in one transaction on the
// server, because the two are joined only by the session number they share and
// moving one without the other silently mismatches them. See the `reorder`
// callback, and /api/trainer/packages/[packageId]/session-plans/reorder.

interface Step {
  id: string
  sessionIndex: number
  title: string
  /** PUBLIC — the client reads this on their session. Rich text. */
  description: string | null
  /** PRIVATE — the trainer's own jottings. Never sent to a client. */
  privateNote: string | null
}

/**
 * A session that is actually in the diary, as the host already has it.
 *
 * `href` rather than an id + a base path: the same run is reachable under
 * /classes, /casual-classes and /doggy-daycare, and which one the trainer came
 * in through is the host's business, not this component's.
 */
export type ScheduledSession = {
  id: string
  sessionIndex: number | null
  /** ISO — formatted here so every row reads the same way. */
  scheduledAt: string
  href: string
}

/** Date and time as the trainer reads their day — explicit hour12, because the
 *  browser locale renders 19:00 and a roll is scanned in am/pm. */
function whenLabel(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString([], { dateStyle: 'medium' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`
}

/** null is the "every session" homework bucket; numbers are session numbers. */
type Bucket = number | null

const bucketKey = (b: Bucket) => (b === null ? 'every' : String(b))

export function SeriesCurriculumEditor({
  packageId,
  sessionCount,
  /**
   * A cohort works through the curriculum together, so step N is week N and
   * nothing is skipped for one dog. A consult is booked per client and can be.
   * That is the only difference between the two, and it is a sentence.
   */
  isGroup = false,
  /**
   * The run's sessions as they stand in the diary. Omitted by a 1:1 package,
   * which has no run — the list then shows the curriculum alone, as before.
   */
  scheduledSessions,
  /**
   * List (one row per session) or grid (a card each). The host owns the choice
   * — the toggle sits on the tab's heading line beside "Add a session", not
   * inside the list it reorders.
   */
  view = 'list',
  /**
   * Told whenever this drills into a session or comes back to the list, so the
   * HOST can hide the controls that only make sense over the list — the
   * grid/list toggle and "Add a session" both belong to the list, and they sat
   * there unchanged while you were inside session 1 writing its plan.
   */
  onViewingListChange,
}: {
  packageId: string
  sessionCount: number
  isGroup?: boolean
  scheduledSessions?: ScheduledSession[]
  view?: 'list' | 'grid'
  onViewingListChange?: (viewingList: boolean) => void
}) {
  const [steps, setSteps] = useState<Record<number, Step>>({})
  const [homeworkCounts, setHomeworkCounts] = useState<Record<string, number>>({})
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 'list' is the session list; anything else is the session opened from it. */
  const [open, setOpen] = useState<Bucket | 'list'>('list')

  const load = useCallback(async () => {
    const res = await fetch(`/api/trainer/packages/${packageId}/session-plans`)
    const rows = res.ok ? ((await res.json()) as Step[]) : []
    setSteps(Object.fromEntries((Array.isArray(rows) ? rows : []).map(r => [r.sessionIndex, r])))
    setLoaded(true)
  }, [packageId])

  // The list says how much homework each session carries, so a glance shows
  // what is filled in. Read only — the homework itself is owned, and written,
  // by `DefaultHomeworkEditor` on the session's own screen. Counted again on
  // the way back to the list, because homework was very likely just added on
  // the screen you are leaving.
  const loadHomeworkCounts = useCallback(async () => {
    const res = await fetch(`/api/trainer/packages/${packageId}/default-homework`)
    const rows = res.ok ? ((await res.json()) as { sessionIndex: number | null }[]) : []
    const next: Record<string, number> = {}
    for (const r of Array.isArray(rows) ? rows : []) {
      const k = bucketKey(r.sessionIndex)
      next[k] = (next[k] ?? 0) + 1
    }
    setHomeworkCounts(next)
  }, [packageId])

  const loadAll = useCallback(async () => {
    await Promise.all([load(), loadHomeworkCounts()])
  }, [load, loadHomeworkCounts])

  useEffect(() => { void loadAll() }, [loadAll])

  const backToList = useCallback(() => {
    setOpen('list')
    onViewingListChange?.(true)
    void loadHomeworkCounts()
  }, [loadHomeworkCounts, onViewingListChange])

  // Typing is saved on blur, not per keystroke. A curriculum is written in
  // prose — a request per character would be a request per character.
  const saving = useRef<Set<number>>(new Set())
  const save = useCallback(
    async (sessionIndex: number, patch: { title?: string; description?: string | null; privateNote?: string | null }) => {
      const current = steps[sessionIndex]
      const title = (patch.title ?? current?.title ?? '').trim()
      const description = patch.description !== undefined ? patch.description : (current?.description ?? null)
      const privateNote = patch.privateNote !== undefined ? patch.privateNote : (current?.privateNote ?? null)
      // Nothing typed and nothing stored — there is no step to save or delete.
      if (!title && !current) return

      saving.current.add(sessionIndex)
      setError(null)
      const res = await fetch(`/api/trainer/packages/${packageId}/session-plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionIndex,
          title,
          description: description || null,
          privateNote: privateNote || null,
        }),
      })
      saving.current.delete(sessionIndex)
      if (!res.ok) { setError('Could not save that step.'); return }
      await load()
    },
    [packageId, steps, load],
  )

  /**
   * Drag a session to a new place in the curriculum.
   *
   * `orderedIds` is the numbered rows in their new arrangement, so the content
   * of `orderedIds[i]` belongs on the i-th of those same numbers. The NUMBERS
   * do not travel — 1..6 stay 1..6 down the screen — what moves is the plan and
   * the homework sitting on each, which is what the trainer means by "teach
   * loose-lead in week 1 this time".
   *
   * The "every session" bucket is never in this list: it belongs to no session,
   * so there is no position for it to be dragged to.
   *
   * The DATES never move either. `scheduledByIndex` is built from the host's
   * props and is untouched here, and the server writes nothing to
   * TrainingSession — a class run keeps every booking exactly where the cohort
   * expects it, and only what is taught that week changes.
   *
   * Applied locally first because the whole list re-labels at once: waiting on a
   * round-trip leaves the row you dropped sitting in its old place, and the
   * obvious reading of that is that the drag didn't take.
   */
  const reorder = useCallback(
    async (orderedIds: string[]) => {
      const from = orderedIds.map(Number)
      if (from.some(Number.isNaN)) return
      const to = [...from].sort((a, b) => a - b)

      setError(null)
      setSteps(prev => {
        const next: Record<number, Step> = {}
        // Anything outside the dragged set keeps its number untouched.
        for (const [key, step] of Object.entries(prev)) {
          if (!from.includes(Number(key))) next[Number(key)] = step
        }
        from.forEach((old, i) => {
          const step = prev[old]
          if (step) next[to[i]] = { ...step, sessionIndex: to[i] }
        })
        return next
      })
      // Counts move with their session for the same reason the rows do — a list
      // that renames a session but leaves "3 homework tasks" behind is the exact
      // confusion this feature exists to remove.
      setHomeworkCounts(prev => {
        const next: Record<string, number> = {}
        for (const [key, count] of Object.entries(prev)) {
          if (key === 'every' || !from.includes(Number(key))) next[key] = count
        }
        from.forEach((old, i) => {
          const count = prev[bucketKey(old)]
          if (count !== undefined) next[bucketKey(to[i])] = count
        })
        return next
      })

      const res = await fetch(`/api/trainer/packages/${packageId}/session-plans/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: from }),
      })
      if (!res.ok) setError('Could not save that order.')
      // Re-read either way: on failure to undo the optimistic move, on success
      // to confirm the plans and the homework agree about what moved where.
      await loadAll()
    },
    [packageId, loadAll],
  )

  const intro = (
    <p className="text-sm leading-relaxed text-slate-500">
      What each session covers, and the homework that follows it — your clients
      read both. Naming a step is what gives this offering a curriculum; leave
      them blank and it behaves exactly as it did before.{' '}
      {isGroup
        ? 'The class works through it together — step 1 is week 1 — so there is nothing to change per client.'
        : 'Clients sign up to the whole series; you book the sessions themselves whenever suits. You can skip a step for a dog that already has it — do that on the session itself, not here.'}
    </p>
  )

  const stepHeader = useCallback(
    (sessionIndex: number) => (
      <StepFields
        key={sessionIndex}
        step={steps[sessionIndex]}
        onSave={patch => save(sessionIndex, patch)}
      />
    ),
    [steps, save],
  )

  // A session written past the end of a shortened offering. It still exists and
  // still needs to be reachable, so it gets a row of its own rather than being
  // silently dropped off the bottom of the list.
  const overrun = useMemo(
    () => Object.values(steps).map(s => s.sessionIndex).filter(n => n > sessionCount).sort((a, b) => a - b),
    [steps, sessionCount],
  )

  // Scheduled sessions keyed by their number, so a row can carry both its plan
  // and its date. A session with no number (a drop-in booking) can't be matched
  // to a step and is listed separately below.
  const scheduledByIndex = useMemo(() => {
    const m = new Map<number, ScheduledSession>()
    for (const s of scheduledSessions ?? []) {
      if (s.sessionIndex != null && !m.has(s.sessionIndex)) m.set(s.sessionIndex, s)
    }
    return m
  }, [scheduledSessions])

  /** Booked sessions that no numbered row will show — listed on their own. */
  const unnumbered = useMemo(
    () => (scheduledSessions ?? []).filter(s => s.sessionIndex == null),
    [scheduledSessions],
  )

  /** Every numbered session on screen, ascending. The draggable set. */
  const numbered: number[] = useMemo(() => {
    const set = new Set<number>([
      ...Array.from({ length: Math.max(0, sessionCount) }, (_, i) => i + 1),
      ...overrun,
      // A session booked beyond the offering's own count still has to appear —
      // it is in the diary, and a list that hides it is worse than a long one.
      ...scheduledByIndex.keys(),
    ])
    return [...set].sort((a, b) => a - b)
  }, [sessionCount, overrun, scheduledByIndex])

  // The "every session" bucket rides along at the end of the grid, where it has
  // always been. It is NOT part of `numbered` — see `reorder` below.
  const rows: Bucket[] = useMemo(() => [...numbered, null], [numbered])

  // Steps with no session booked to cover them. A six-step curriculum on a
  // five-week run is a real mistake, and a list of what IS booked can only show
  // the sessions that exist — so it's said here rather than found in week six.
  const unscheduledSteps = useMemo(() => {
    if (!scheduledSessions) return 0
    return Object.values(steps).filter(s => !scheduledByIndex.has(s.sessionIndex)).length
  }, [steps, scheduledByIndex, scheduledSessions])

  if (!loaded) return null

  // One session is not a list. Ongoing offerings (no session count) have no
  // numbered sessions at all — both keep the flat editor they always had.
  if (sessionCount <= 1) {
    return (
      <div className="flex flex-col gap-5">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {/* There is no numbered curriculum to merge into here, but the dates
            still have to be reachable: an ongoing offering (daycare, a casual
            class) has sessionCount 0 and can have dozens of them, and they used
            to be listed on the Details tab. */}
        {(scheduledSessions?.length ?? 0) > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">
              Scheduled sessions
              <span className="ml-1.5 font-normal text-slate-400">{scheduledSessions!.length}</span>
            </h3>
            <FlatBlock>
              {scheduledSessions!.map(s => (
                <ScheduledRow key={s.id} session={s} />
              ))}
            </FlatBlock>
          </div>
        )}
        <DefaultHomeworkEditor
          packageId={packageId}
          sessionCount={sessionCount}
          everySessionLast
          intro={intro}
          stepHeader={stepHeader}
        />
      </div>
    )
  }

  if (open !== 'list') {
    const step = open === null ? undefined : steps[open]
    return (
      <div className="flex flex-col gap-5">
        <div>
          <button
            type="button"
            onClick={backToList}
            className="-ml-1.5 inline-flex items-center gap-1 rounded-lg py-1 pl-1 pr-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} /> All sessions
          </button>
          <h3 className="mt-2 text-base font-semibold text-slate-900">
            {open === null ? 'Every session' : `Session ${open}`}
          </h3>
          <p className="mt-0.5 text-sm text-slate-500">
            {open === null
              ? 'Homework handed out after every session of this offering, on top of whatever that session sets.'
              : step?.title
                ? 'What this session covers, and the homework that follows it. Your client reads both.'
                : 'Write what this session covers — your client reads it. Naming it is what gives this offering a curriculum.'}
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DefaultHomeworkEditor
          packageId={packageId}
          sessionCount={sessionCount}
          onlySessionIndex={open}
          stepHeader={stepHeader}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {intro}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        {view === 'grid' ? (
          // Two to four across, the same grid the shop and the library use.
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {rows.map(bucket => (
              <SessionTile
                key={bucketKey(bucket)}
                bucket={bucket}
                step={bucket === null ? undefined : steps[bucket]}
                homework={homeworkCounts[bucketKey(bucket)] ?? 0}
                past={bucket !== null && bucket > sessionCount}
                scheduled={bucket === null ? undefined : scheduledByIndex.get(bucket)}
                onOpen={() => { setOpen(bucket); onViewingListChange?.(false) }}
              />
            ))}
          </div>
        ) : (
        // DRAGGABLE, in the list view only. The grid is a board you scan; the
        // list is the curriculum read in order, which is the thing being
        // rearranged. One session has no order to change, so the grip is only
        // hung on lists with something to move.
        //
        // Keyed by the session NUMBER, which is stable for the whole drag —
        // dnd-kit needs an id that survives the reorder, and the numbers stay
        // put while the content moves between them.
        <SortableOfferingList ids={numbered.map(String)} onReorder={reorder}>
          <FlatBlock>
            {numbered.map(bucket => (
              <SortableOfferingCard key={bucket} id={String(bucket)}>
                {handle => (
                  <SessionRow
                    bucket={bucket}
                    step={steps[bucket]}
                    homework={homeworkCounts[bucketKey(bucket)] ?? 0}
                    past={bucket > sessionCount}
                    scheduled={scheduledByIndex.get(bucket)}
                    onOpen={() => { setOpen(bucket); onViewingListChange?.(false) }}
                    handle={numbered.length > 1 ? handle : undefined}
                  />
                )}
              </SortableOfferingCard>
            ))}
            {/* Outside the sortable set on purpose: "every session" homework
                belongs to no session, so there is no position to drag it to. */}
            <SessionRow
              bucket={null}
              step={undefined}
              homework={homeworkCounts[bucketKey(null)] ?? 0}
              past={false}
              scheduled={undefined}
              onOpen={() => { setOpen(null); onViewingListChange?.(false) }}
            />
          </FlatBlock>
        </SortableOfferingList>
        )}

        {/* Bookings that carry no session number — a drop-in class books them
            per client, so they belong to no step. */}
        {unnumbered.length > 0 && (
          <div className="mt-4">
            <h4 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Other booked sessions
            </h4>
            <FlatBlock>
              {unnumbered.map(s => <ScheduledRow key={s.id} session={s} />)}
            </FlatBlock>
          </div>
        )}

        {overrun.length > 0 && (
          <p className="mt-2 px-1 text-xs text-amber-700">
            {overrun.length === 1 ? 'Session ' : 'Sessions '}
            {overrun.join(', ')} {overrun.length === 1 ? 'sits' : 'sit'} past the{' '}
            {sessionCount} this offering runs, so {overrun.length === 1 ? 'it' : 'they'} won&rsquo;t
            be used. Add more sessions to the offering, or clear the step.
          </p>
        )}

        {unscheduledSteps > 0 && (
          <p className="mt-2 px-1 text-xs text-slate-500">
            {unscheduledSteps} step{unscheduledSteps === 1 ? '' : 's'} in the curriculum
            {unscheduledSteps === 1 ? ' has' : ' have'} no session booked for {unscheduledSteps === 1 ? 'it' : 'them'}.
          </p>
        )}

      </div>
    </div>
  )
}

/**
 * One session as a CARD, for the grid view.
 *
 * Same three facts as the row — the number, what it covers, and how much is on
 * it — laid out down instead of across, so a curriculum can be scanned as a
 * board rather than a list. Deliberately NOT a variant of SessionRow: one
 * component that reflows two ways is how the offering card ended up crushing
 * its own title on a phone (AGENTS.md).
 */
function SessionTile({
  bucket,
  step,
  homework,
  past,
  scheduled,
  onOpen,
}: {
  bucket: Bucket
  step: Step | undefined
  homework: number
  past: boolean
  scheduled: ScheduledSession | undefined
  onOpen: () => void
}) {
  const title = bucket === null ? 'Every session' : (step?.title || `Session ${bucket}`)
  const unwritten = bucket !== null && !step?.title

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 flex-col items-start gap-2 p-4 text-left transition-colors active:bg-slate-50"
      >
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums ${
            past ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
          }`}
          aria-hidden
        >
          {bucket === null ? <Repeat className="h-4 w-4" strokeWidth={1.75} /> : bucket}
        </span>
        <span className={`line-clamp-2 text-sm font-medium ${unwritten ? 'text-slate-500' : 'text-slate-900'}`}>
          {title}
        </span>
        <span className="mt-auto flex flex-col gap-0.5 text-xs text-slate-400">
          {scheduled && <span>{whenLabel(scheduled.scheduledAt)}</span>}
          <span>
            {homework === 0 ? 'No homework' : homework === 1 ? '1 homework task' : `${homework} homework tasks`}
          </span>
          {past && <span className="text-amber-700">Past the end of this offering</span>}
        </span>
      </button>
      {scheduled && (
        <Link
          href={scheduled.href}
          onClick={e => e.stopPropagation()}
          title="Open this session"
          className="border-t border-slate-100 px-4 py-2 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
        >
          Open this session
        </Link>
      )}
    </div>
  )
}

/**
 * Grow the offering by one session.
 *
 * It ASKS FIRST, which a one-tap "+" would not. `sessionCount` is what the
 * offering sells, and the packages PATCH recalculates the settled price
 * whenever it changes — so on anything priced per session this button changes
 * what a client pays. That is worth a sentence, not a surprise on the next
 * invoice.
 *
 * Not offered on a class RUN. There the sessions are real diary entries a
 * cohort turns up to, so "add a session" means scheduling one — a different
 * job, with a date and a time, which the schedule already does.
 */
export function AddSessionButton({
  packageId,
  sessionCount,
  scheduled,
}: {
  packageId: string
  sessionCount: number
  scheduled?: ScheduledSession[]
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  if (scheduled !== undefined) return null

  async function add() {
    setBusy(true)
    setFailed(null)
    try {
      const res = await fetch(`/api/packages/${packageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCount: sessionCount + 1 }),
      })
      if (!res.ok) { setFailed('Could not add a session.'); return }
      setConfirming(false)
      router.refresh()
    } catch {
      setFailed('Could not add a session.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        <Plus className="h-4 w-4 text-slate-500" strokeWidth={2.25} />
        Add a session
      </button>
      {failed && <p className="mt-2 px-1 text-xs text-red-600">{failed}</p>}

      {confirming && (
        <ConfirmSheet
          title={`Run ${sessionCount + 1} sessions?`}
          body={`This offering runs ${sessionCount} at the moment. If it is priced per session, the total price moves with the count — check it before anyone books.`}
          confirmLabel="Add a session"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={add}
        />
      )}
    </>
  )
}

/**
 * One line of the curriculum: what the session is, and how much is on it.
 *
 * Hand-rolled rather than `FlatRow` because the session NUMBER leads — a
 * curriculum is read in order, and the number is what the trainer is counting
 * along. `FlatRow` only takes an icon there.
 */
function SessionRow({
  bucket,
  step,
  homework,
  past,
  scheduled,
  onOpen,
  handle,
}: {
  bucket: Bucket
  step: Step | undefined
  homework: number
  past: boolean
  /** Its slot in the diary, when this session is actually booked. */
  scheduled: ScheduledSession | undefined
  onOpen: () => void
  /**
   * The grip this row is dragged by, when the row is part of a reorderable
   * list. Omitted for the "every session" bucket and for a one-row list.
   */
  handle?: ReactNode
}) {
  const title = bucket === null ? 'Every session' : (step?.title || `Session ${bucket}`)
  const unwritten = bucket !== null && !step?.title

  const sub = [
    // The date leads: on a class that is running, "which week is loose-lead?"
    // is answered by the date, and the plan is what qualifies it.
    scheduled ? whenLabel(scheduled.scheduledAt) : null,
    bucket === null
      ? 'On top of each session’s own'
      : unwritten
        ? 'No description yet'
        : null,
    homework === 0 ? 'No homework' : homework === 1 ? '1 homework task' : `${homework} homework tasks`,
    past ? 'Past the end of this offering' : null,
  ].filter(Boolean).join(' · ')

  // The row opens the PLAN; the link opens the session itself. Two destinations
  // on one line, so the link stops the click rather than doing both.
  return (
    <div className="flex items-stretch">
      {/* The grip sits OUTSIDE the button. Nesting it would put a button inside
          a button — invalid HTML that React warns about, and the drag listeners
          would fight the row's own click. */}
      {handle && <div className="flex flex-shrink-0 items-start pl-1.5 pt-3">{handle}</div>}
      <button
        type="button"
        onClick={onOpen}
        className={`flex min-w-0 flex-1 items-start gap-3 py-3 pr-4 text-left transition-colors active:bg-slate-50 ${handle ? 'pl-2' : 'pl-4'}`}
      >
        <span
          className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${
            past ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
          }`}
          aria-hidden
        >
          {bucket === null ? <Repeat className="h-3.5 w-3.5" strokeWidth={1.75} /> : bucket}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-medium ${unwritten ? 'text-slate-500' : 'text-slate-900'}`}>
            {title}
          </span>
          <span className="block truncate text-xs text-slate-400">{sub}</span>
        </span>
        {!scheduled && <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />}
      </button>
      {scheduled && (
        <Link
          href={scheduled.href}
          onClick={e => e.stopPropagation()}
          title="Open this session"
          className="flex flex-shrink-0 items-center gap-1.5 px-3 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
        >
          <ClipboardCheck className="h-4 w-4" strokeWidth={1.75} />
          <span className="hidden sm:inline">Open</span>
        </Link>
      )}
    </div>
  )
}

/**
 * A booked session with no curriculum step behind it — an ongoing offering's
 * dates, or a drop-in booking that belongs to no week. Nothing to open but the
 * session itself, so the whole row is the link.
 */
function ScheduledRow({ session }: { session: ScheduledSession }) {
  return (
    <Link
      href={session.href}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-slate-50"
    >
      <span
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold tabular-nums text-slate-500"
        aria-hidden
      >
        {session.sessionIndex ?? <ClipboardCheck className="h-3.5 w-3.5" strokeWidth={1.75} />}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
        {whenLabel(session.scheduledAt)}
      </span>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
    </Link>
  )
}

/**
 * The plan for one step. Uncontrolled-with-a-reset: local state so typing is
 * smooth, re-seeded whenever the saved row changes underneath it.
 *
 * The description is rich text — the same `RichTextEditor` every other
 * description in the app is written in, storing the same constrained HTML, so
 * it displays through `RichText` like all of them. The TITLE stays a plain
 * input: it is a label, printed inline as "Step 3 · Loose-lead walking", and
 * markup in it would have to be stripped everywhere it's read.
 *
 * Descriptions written before this were plain text. Nothing is migrated and
 * nothing needs to be: `emailBodyToHtml` (inside the editor) wraps plain text
 * into paragraphs when it loads, and `sanitizeRichHtml` (inside `RichText`)
 * passes plain text through untouched when it displays — so an old description
 * reads correctly either way and quietly becomes HTML the next time it's saved.
 */
function StepFields({
  step,
  onSave,
}: {
  step: Step | undefined
  onSave: (patch: { title?: string; description?: string | null; privateNote?: string | null }) => void
}) {
  const [title, setTitle] = useState(step?.title ?? '')

  useEffect(() => { setTitle(step?.title ?? '') }, [step?.title])

  return (
    <div className="mb-4 flex flex-col gap-4">
      <input
        type="text"
        value={title}
        maxLength={120}
        onChange={e => setTitle(e.target.value)}
        onBlur={() => { if (title !== (step?.title ?? '')) onSave({ title }) }}
        placeholder="What happens this session — e.g. Loose-lead walking"
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />

      {/* TWO IDENTICAL EDITORS, so the LABEL is the only thing keeping a
          private thought out of the client's copy. That is why each one is
          colour-coded, icon-led and badged with who reads it, rather than
          distinguished by the words "description" and "note" — which nobody
          reliably tells apart while typing quickly.

          The public one is boxed in emerald and says so twice; the private one
          is grey and locked. Same component, same stored shape, so neither can
          drift into its own rich-text pattern. */}
      <div className="flex flex-col gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
        <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-emerald-900">
          <Eye className="h-3.5 w-3.5 text-emerald-600" strokeWidth={1.75} />
          What you&rsquo;ll cover
          <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Your client reads this
          </span>
        </span>
        <RichNoteField
          key={`desc-${step?.id ?? 'unsaved'}`}
          initial={step?.description ?? ''}
          onCommit={v => onSave({ description: v })}
        />
      </div>

      <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-700">
          <Lock className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
          Private note
          <span className="rounded-full bg-slate-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Only you — never shown to clients
          </span>
        </span>
        <RichNoteField
          key={`note-${step?.id ?? 'unsaved'}`}
          initial={step?.privateNote ?? ''}
          onCommit={v => onSave({ privateNote: v })}
        />
      </div>
    </div>
  )
}

/**
 * One rich-text field that commits on blur.
 *
 * Owns its own draft and is seeded ONCE, from `initial`, by its mount — which
 * is why every caller keys it. `RichTextEditor` deliberately has no
 * content-sync effect (it seeds the document on mount and never re-reads
 * `value`), so a key is the only thing that can re-point it at a different
 * step, and a state-syncing effect here would be both useless to the editor and
 * a cascading render.
 *
 * Committing on blur, not per keystroke: a curriculum is written in prose, and
 * a request per character is a request per character.
 */
function RichNoteField({
  initial,
  onCommit,
}: {
  initial: string
  onCommit: (html: string) => void
}) {
  const [value, setValue] = useState(initial)
  // What is actually stored, tracked across commits. Comparing against
  // `initial` alone goes stale the moment the first blur saves something:
  // typing a note, saving it, then clearing it again would compare "" to the
  // original "" and skip the save, leaving the cleared text still stored.
  const committed = useRef(initial)
  return (
    <RichTextEditor
      theme="light"
      minHeight={120}
      value={value}
      onChange={setValue}
      onBlur={() => {
        if (value === committed.current) return
        committed.current = value
        onCommit(value)
      }}
    />
  )
}
