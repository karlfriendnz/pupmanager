'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '@/components/shared/page-header'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'
import { SuggestedHomework } from '@/components/trainer/suggested-homework'
import { SessionSeriesStep } from '@/components/trainer/session-series-step'
import { formatDate, formatTime } from '@/lib/utils'
import { sessionFormSourceLabel, type SessionFormSource } from '@/lib/session-form'
import { SetPageImmersive } from '@/components/shared/page-title'
import {
  ClipboardCheck, ChevronLeft, ChevronRight, Check, X,
  GraduationCap, Calendar, FileText, ListChecks, CheckSquare,
} from 'lucide-react'

type AttStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'MAKEUP'

// Status is real information, so it still gets a word and a mark — but no
// tinted row backgrounds and no five-colour palette. Present and absent are
// the two the trainer taps between; the rest read as plain text (AGENTS.md:
// no decorative colour).
const STATUS_LABEL: Record<AttStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  EXCUSED: 'Excused',
  MAKEUP: 'Makeup',
}
const ALL_STATUSES: AttStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'MAKEUP']

type FormQuestion = { id: string; type: string; label?: string; options?: string[] }

// Checkbox answers store multiple values as a JSON array string; single choices
// store the picked option verbatim. Mirrors the helpers in session-form-report.
function parseChecks(value: string): string[] {
  if (!value) return []
  try {
    const arr = JSON.parse(value)
    return Array.isArray(arr) ? arr.map(String) : []
  } catch {
    return [value]
  }
}
function serializeChecks(list: string[]): string {
  return list.length ? JSON.stringify(list) : ''
}
type FormLite = { id: string; name: string; questions: FormQuestion[] }
type RosterRow = {
  enrollmentId: string
  clientName: string
  dogName: string | null
  dogPhotoUrl: string | null
  dogBreed: string | null
  type: string
  status: AttStatus
  note: string
  hasReport: boolean
  report: { answers?: Record<string, string>; closing?: string | null } | null
  /** The form THIS client gets, already resolved (enrolment → session → class). */
  formId: string | null
  /** Which level decided it, so the roster can mark the ones that differ. */
  formSource: SessionFormSource
  /** Their own override, if they have one — what the per-client picker edits. */
  ownFormId: string | null
}
type AttendanceData = {
  sessionFormId: string | null
  effectiveForm: FormLite | null
  availableForms: FormLite[]
  roster: RosterRow[]
}
// No `note` here any more — the per-row "quick note" is gone (Karl: "not sure
// what that is for"). Nobody had ever written one: 46 attendance rows in
// production, 0 notes. The column and the API field stay (the route treats
// note as optional and only writes it when sent), so nothing is destroyed and
// it can come back if it's ever actually wanted. The real write-up lives in
// the report screen next to it, which is what trainers use.
type ClientDraft = { status: AttStatus; answers: Record<string, string>; recap: string }

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'
}

// Dog avatar (photo or initials) with a present/absent mark — the at-a-glance
// signal. Anything other than those two is said in words on the row instead;
// a five-colour dot vocabulary was never readable at a glance anyway.
function StatusAvatar({ name, photoUrl, status }: { name: string; photoUrl: string | null; status: AttStatus }) {
  const absent = status === 'ABSENT'
  return (
    <span className="relative flex-shrink-0">
      <span className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-500 ${absent ? 'opacity-40 grayscale' : ''}`}>
        {photoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          : initialsOf(name)}
      </span>
      {(status === 'PRESENT' || status === 'ABSENT') && (
        <span className={`absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white ${status === 'PRESENT' ? 'bg-emerald-500 text-white' : 'bg-slate-300 text-white'}`}>
          {status === 'PRESENT' ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : <X className="h-2.5 w-2.5" strokeWidth={3} />}
        </span>
      )}
    </span>
  )
}

/**
 * The status / "mark everyone as…" picker.
 *
 * Replaces the two dropdowns this screen used to hang off a corner — a 160px
 * status menu and a "Mark as…" <select> — neither of which is a phone control
 * for five options (AGENTS.md: full screens, not dropdowns).
 *
 * The shell is shared: the whole screen on a phone, a centred panel on a
 * desktop, where a full-bleed grey page holding five short rows was the mess
 * Karl marked.
 */
function ChoiceScreen({
  title,
  sub,
  options,
  activeId,
  onPick,
  onClose,
}: {
  title: string
  sub?: string
  options: { id: string; label: string; sub?: string }[]
  activeId?: string | null
  onPick: (id: string) => void
  onClose: () => void
}) {
  return (
    <FullScreenSheet title={title} sub={sub} onClose={onClose}>
      <div className="mx-auto w-full max-w-lg">
        <FlatBlock>
          {options.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o.id)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{o.label}</span>
                {o.sub && <span className="mt-0.5 block truncate text-[13px] text-slate-500">{o.sub}</span>}
              </span>
              {activeId === o.id && <Check className="h-4 w-4 flex-shrink-0 text-slate-700" strokeWidth={1.75} />}
            </button>
          ))}
        </FlatBlock>
      </div>
    </FullScreenSheet>
  )
}

// The class session screen. Two phases at different times:
//   1) Attendance — tap to mark present/absent, hold for the status screen.
//   2) Notes — later, write up each client's form.
export function SessionView({
  runId,
  sessionId,
  runName,
  sessionTitle,
  sessionScheduledAt,
  tz,
  // Which offering section this session sits under, so "Back to class" returns
  // to the right run detail (/classes, /casual-classes or /doggy-daycare).
  basePath = '/classes',
  write = false,
}: {
  runId: string
  sessionId: string
  runName: string
  sessionTitle: string
  sessionScheduledAt: string
  /** The trainer's configured timezone — every date on the page renders in it. */
  tz: string
  basePath?: string
  /**
   * Arrived from "Start notes" rather than "Take attendance" (the session
   * screen has both, pointed at this one screen). The register is the same
   * list of people either way; what changes is what a tap on a row MEANS —
   * write this client up, rather than mark them present.
   */
  write?: boolean
}) {
  const router = useRouter()
  const [data, setData] = useState<AttendanceData | null>(null)
  const [formId, setFormId] = useState('')
  const [draft, setDraft] = useState<Record<string, ClientDraft>>({})
  const [notesFor, setNotesFor] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [formPicker, setFormPicker] = useState(false)
  // Which client's own form is being picked (an enrollmentId), if any.
  const [ownFormPicker, setOwnFormPicker] = useState<string | null>(null)
  const [bulkPicker, setBulkPicker] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/class-runs/${runId}/sessions/${sessionId}/attendance`)
    if (!res.ok) { setError('Could not load the session.'); return }
    const d: AttendanceData = await res.json()
    setData(d)
    setFormId(d.effectiveForm?.id ?? '')
    setDraft(Object.fromEntries(d.roster.map(r => [r.enrollmentId, {
      status: r.status,
      answers: r.report?.answers ?? {},
      recap: r.report?.closing ?? '',
    }])))
  }, [runId, sessionId])

  useEffect(() => { void load() }, [load])

  const selectedForm = data?.availableForms.find(f => f.id === formId) ?? null

  async function put(body: object): Promise<boolean> {
    const res = await fetch(`/api/class-runs/${runId}/sessions/${sessionId}/attendance`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return res.ok
  }

  async function saveAttendance() {
    if (!data) return
    setSaving(true); setError(null)
    try {
      // `note` is deliberately absent: the route only writes it when it's
      // sent, so leaving it out marks attendance without touching any note
      // that already exists.
      const records = data.roster.map(r => ({ enrollmentId: r.enrollmentId, status: draft[r.enrollmentId].status }))
      const ok = await put({ sessionFormId: formId || null, records })
      if (!ok) { setError('Could not save attendance.'); return }
      setSaved('Attendance saved'); setTimeout(() => setSaved(null), 2000)
    } finally { setSaving(false) }
  }

  async function saveNotes(enrollmentId: string) {
    const d = draft[enrollmentId]
    const row = data?.roster.find(r => r.enrollmentId === enrollmentId)
    setSaving(true); setError(null)
    try {
      // The report records the form THIS client was written up on, not the
      // session's — they may be on their own. And sessionFormId is deliberately
      // omitted: writing up one person must not reassign the whole session's
      // form, which is what sending the resolved value used to do (it copied the
      // class default down onto the session, so later changing the class default
      // silently stopped reaching it).
      const ok = await put({ records: [{ enrollmentId, report: { formId: row?.formId ?? null, answers: d.answers, closing: d.recap.trim() || null } }] })
      if (!ok) { setError('Could not save the notes.'); return }
      setNotesFor(null); setSaved('Notes saved'); await load(); setTimeout(() => setSaved(null), 2000)
    } finally { setSaving(false) }
  }

  /**
   * Put one client on their own form — or back on everyone else's.
   *
   * Saved on the spot rather than with the write-up, because it belongs to the
   * ENROLMENT ("Rex is in for reactivity"), which is true every week, not to
   * tonight's notes. A trainer who sets it and closes the screen expects it to
   * have stuck.
   */
  async function setOwnForm(enrollmentId: string, id: string | null) {
    setSaving(true); setError(null)
    try {
      const ok = await put({ records: [{ enrollmentId, ownFormId: id }] })
      if (!ok) { setError('Could not change their form.'); return }
      await load()
    } finally { setSaving(false) }
  }

  function setAnswer(enrollmentId: string, qid: string, value: string) {
    setDraft(p => ({ ...p, [enrollmentId]: { ...p[enrollmentId], answers: { ...p[enrollmentId].answers, [qid]: value } } }))
  }
  function toggleStatus(id: string) {
    setDraft(p => ({ ...p, [id]: { ...p[id], status: p[id].status === 'PRESENT' ? 'ABSENT' : 'PRESENT' } }))
  }
  function setStatus(id: string, s: AttStatus) {
    setDraft(p => ({ ...p, [id]: { ...p[id], status: s } }))
  }
  // Quick tap = present/absent; press-and-hold = the status screen.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  function startPress(id: string) {
    if (selectMode) return
    longPressed.current = false
    pressTimer.current = setTimeout(() => { longPressed.current = true; setMenuFor(id) }, 450)
  }
  function endPress() { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null } }
  function rowTap(id: string) {
    if (longPressed.current) { longPressed.current = false; return }
    // Came in to write people up: a tap opens that client's write-up. Marking
    // them present is still a press-and-hold away, so nothing is lost.
    if (write) { setNotesFor(id); return }
    toggleStatus(id)
  }

  // Bulk selection mode: pick several, then apply one status to all.
  function toggleSelected(id: string) {
    setSelected(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function exitSelect() { setSelectMode(false); setSelected(new Set()) }
  function applyToSelected(s: AttStatus) {
    setDraft(p => { const next = { ...p }; selected.forEach(id => { if (next[id]) next[id] = { ...next[id], status: s } }); return next })
    exitSelect()
  }

  const notesRow = notesFor ? data?.roster.find(r => r.enrollmentId === notesFor) ?? null : null
  // The write-up uses THIS client's form, which is not always the session's.
  const notesForm = notesRow ? data?.availableForms.find(f => f.id === notesRow.formId) ?? null : null
  const pickerRow = ownFormPicker ? data?.roster.find(r => r.enrollmentId === ownFormPicker) ?? null : null
  const presentCount = data ? data.roster.filter(r => draft[r.enrollmentId]?.status === 'PRESENT').length : 0
  // "Reactive Rover Group — session 1/6" → "Session 1/6" (class name lives in the title).
  const sessionLabel = sessionTitle.includes('—') ? sessionTitle.split('—').pop()!.trim().replace(/^session/i, 'Session') : null
  const menuRow = menuFor ? data?.roster.find(r => r.enrollmentId === menuFor) ?? null : null

  return (
    <>
      {/* The five bottom tabs stand down while you're taking a register (Karl:
          "no bottom nav please"). They offer to go somewhere ELSE, which is the
          one thing a half-marked register shouldn't invite — and the action bar
          wants the floor. keepTopBar, so the back arrow and the class name
          survive: with the tabs gone that's the only way off the screen. */}
      <SetPageImmersive value keepTopBar />
      {/* The shell reserves 5rem at the foot of every phone screen for those
          tabs. They aren't here, so that reservation is a band of nothing under
          the action bar. Same trick EditScreen uses. */}
      <style>{`@media (max-width: 767px) { .pm-main { padding-bottom: 0 !important; } }`}</style>

      {/* One back affordance, not two. "Back to class" used to sit in the header
          beside the back arrow saying almost the same thing; it's a row on the
          page now (AGENTS.md: nothing says the same thing twice).
          Writing up a client is a screen WITHIN this one, and it used to carry
          its own "Back to attendance" row directly under the header's arrow —
          two back controls stacked, which is what Karl pointed at. So the
          arrow takes that job while the write-up is open: one control, doing
          the thing you actually want at that moment. */}
      <PageHeader
        title={runName}
        back={{
          label: notesRow ? 'Back to attendance' : 'Back',
          onClick: () => {
            // Close the write-up first — leaving the page from inside it would
            // skip the register you were halfway through.
            if (notesRow) { setNotesFor(null); return }
            // Otherwise return to wherever they came from (schedule, dashboard,
            // the class…); fall back to the class page on a deep-linked load.
            if (typeof window !== 'undefined' && window.history.length > 1) router.back()
            else router.push(`${basePath}/${runId}`)
          },
        }}
      />

      {/* flex-1 gives the pinned bar a floor on a SHORT register. Sticky pins
          to the viewport while there's content below it and settles at the END
          of the content when there isn't — so a class with three dogs left the
          Save bar floating 150px up the screen with nothing under it.
          Taking the slack rather than a min-height calc: <main> is already a
          flex column inside a min-h-screen shell, so the space is there to
          claim and there's no constant to be wrong. EditScreen's 5.5rem guess
          overshot here by 104px and bought a scrollbar for empty space.
          pb-40 is gone too — that was clearance for the five bottom tabs,
          which this screen no longer shows. */}
      <div className="w-full flex-1 px-4 pt-4 pb-4 md:px-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          {error && <Alert variant="error">{error}</Alert>}

          {!data ? (
            <p className="py-12 text-center text-sm text-slate-500">Loading…</p>

          ) : notesRow ? (
            /* ─── Notes phase: write up one client ─── */
            <>
              {/* No "Back to attendance" row here any more — it sat directly
                  under the header's own back arrow, two back controls stacked
                  (Karl: "redundant on mobile"). The arrow does this job while
                  the write-up is open. */}
              <FlatBlock>
                <div className="flex items-center gap-3 px-4 py-3">
                  <StatusAvatar name={notesRow.clientName} photoUrl={notesRow.dogPhotoUrl} status={draft[notesRow.enrollmentId].status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-slate-900">{notesRow.clientName}</span>
                    {notesRow.dogName && (
                      <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                        {notesRow.dogName}{notesRow.dogBreed ? ` · ${notesRow.dogBreed}` : ''}
                      </span>
                    )}
                  </span>
                </div>

                {/* Which form THIS client is written up on. A class is one group
                    but not one kind of client — a puppy on foundations and a dog
                    in for reactivity need different questions answered on the
                    same night. Sits here, on the person, because that's where the
                    trainer is when they notice. */}
                <button
                  type="button"
                  onClick={() => setOwnFormPicker(notesRow.enrollmentId)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50"
                >
                  <FileText className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {notesForm ? notesForm.name : 'No form — recap only'}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                      {sessionFormSourceLabel(notesRow.formSource) ?? 'Same as the rest of the class'}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
                </button>

                <div className="flex flex-col gap-3 px-4 py-4">
                  {!notesForm && (
                    <p className="text-[13px] text-slate-500">No form set — pick one above, or just write a recap below.</p>
                  )}
                  {notesForm?.questions.map(q => {
                    const label = q.label ?? 'Field'
                    const val = draft[notesRow.enrollmentId].answers[q.id] ?? ''
                    const isLong = q.type === 'LONG_TEXT'
                    const isNum = q.type === 'NUMBER' || q.type === 'RATING_1_5'
                    const opts = q.options ?? []
                    return (
                      <label key={q.id} className="block">
                        <span className="text-sm font-medium text-slate-700">{label}</span>
                        {q.type === 'DROPDOWN'
                          ? <select value={val} onChange={e => setAnswer(notesRow.enrollmentId, q.id, e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                              <option value="">Select…</option>
                              {opts.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          : q.type === 'RADIO'
                          ? <div className="mt-1 flex flex-col gap-1.5">
                              {opts.map(o => (
                                <label key={o} className="flex items-center gap-2 text-sm text-slate-700">
                                  <input type="radio" checked={val === o} onChange={() => setAnswer(notesRow.enrollmentId, q.id, o)} className="h-4 w-4 border-slate-300 text-accent focus:ring-accent" />
                                  {o}
                                </label>
                              ))}
                            </div>
                          : q.type === 'CHECKBOX'
                          ? <div className="mt-1 flex flex-col gap-1.5">
                              {opts.map(o => {
                                const sel = parseChecks(val)
                                const checked = sel.includes(o)
                                return (
                                  <label key={o} className="flex items-center gap-2 text-sm text-slate-700">
                                    <input type="checkbox" checked={checked} onChange={() => setAnswer(notesRow.enrollmentId, q.id, serializeChecks(checked ? sel.filter(x => x !== o) : [...sel, o]))} className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent" />
                                    {o}
                                  </label>
                                )
                              })}
                            </div>
                          : isLong
                          ? <textarea rows={3} value={val} onChange={e => setAnswer(notesRow.enrollmentId, q.id, e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
                          : <input type={isNum ? 'number' : 'text'} value={val} onChange={e => setAnswer(notesRow.enrollmentId, q.id, e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />}
                      </label>
                    )
                  })}
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">Recap message for the client (optional)</span>
                    <textarea rows={3} value={draft[notesRow.enrollmentId].recap} onChange={e => setDraft(p => ({ ...p, [notesRow.enrollmentId]: { ...p[notesRow.enrollmentId], recap: e.target.value } }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
                  </label>
                  {/* Save and Back have moved to the pinned bar at the foot of
                      the screen (Karl: "sticky to the bottom"). A write-up is
                      longer than a phone, and buttons that live at the end of
                      it can only be reached by scrolling past everything. */}
                </div>
              </FlatBlock>
            </>

          ) : (
            /* ─── Attendance phase ─── */
            <>
              {/* WHEN / WHAT FORM / WHERE THIS SITS — one bordered block,
                  hairline rows, the same shape as the 1:1 session screen. The
                  date used to be a raw toLocaleString() in the subtitle, which
                  printed "27/07/2026, 1:34:00 am" on a phone. */}
              <FlatBlock>
                <div className="flex w-full items-center gap-3 px-4 py-3.5">
                  <Calendar className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900" suppressHydrationWarning>
                      {formatDate(sessionScheduledAt, tz)}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-slate-500" suppressHydrationWarning>
                      {[formatTime(sessionScheduledAt, tz), sessionLabel].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </div>

                {/* Was a bare <select> labelled "Form". A form list is longer
                    than three choices, so it opens a full screen. */}
                <button
                  type="button"
                  onClick={() => setFormPicker(true)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50"
                >
                  <FileText className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">Write-up form</span>
                    <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                      {selectedForm ? selectedForm.name : 'No form — recap only'}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
                </button>

                <button
                  type="button"
                  onClick={() => router.push(`${basePath}/${runId}`)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50"
                >
                  <GraduationCap className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">Back to class</span>
                    <span className="mt-0.5 block truncate text-[13px] text-slate-500">{runName}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
                </button>
              </FlatBlock>

              {/* Roster — ONE block with hairline dividers, not a stack of
                  floating ring-1 cards. An empty roster costs one row. */}
              {data.roster.length === 0 ? (
                <FlatBlock>
                  <div className="flex w-full items-center gap-3 px-4 py-3.5">
                    <ListChecks className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">Nobody enrolled yet</span>
                      <span className="mt-0.5 block truncate text-[13px] text-slate-500">There&apos;s no attendance to mark on this session.</span>
                    </span>
                  </div>
                </FlatBlock>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3 px-1">
                    {selectMode
                      ? <button type="button" onClick={() => setSelected(new Set(data.roster.map(r => r.enrollmentId)))} className="text-[13px] font-medium text-accent">Select all</button>
                      : <p className="text-[13px] text-slate-500">Tap to mark · hold for more</p>}
                    <button
                      type="button"
                      onClick={() => selectMode ? exitSelect() : setSelectMode(true)}
                      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent"
                    >
                      {selectMode ? 'Cancel' : <><CheckSquare className="h-4 w-4" strokeWidth={1.75} /> Select</>}
                    </button>
                  </div>

                  <FlatBlock>
                    {data.roster.map(r => {
                      const d = draft[r.enrollmentId]
                      if (!d) return null
                      const present = d.status === 'PRESENT'
                      const isSelected = selected.has(r.enrollmentId)
                      return (
                        <div key={r.enrollmentId} className={isSelected ? 'bg-slate-50' : ''}>
                          <div className="flex items-center">
                            {/* Tap = present/absent (or select) · hold = status screen */}
                            <button
                              type="button"
                              onClick={() => selectMode ? toggleSelected(r.enrollmentId) : rowTap(r.enrollmentId)}
                              onPointerDown={() => startPress(r.enrollmentId)}
                              onPointerUp={endPress}
                              onPointerLeave={endPress}
                              onPointerMove={endPress}
                              className="flex min-w-0 flex-1 select-none items-center gap-3 py-2.5 pl-4 pr-2 text-left active:bg-slate-50"
                            >
                              {selectMode && (
                                <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${isSelected ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-300'}`}>
                                  {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                                </span>
                              )}
                              <StatusAvatar name={r.clientName} photoUrl={r.dogPhotoUrl} status={d.status} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-slate-900">{r.clientName}</span>
                                <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                                  {r.dogName ?? '—'}
                                  {!present && <> · {STATUS_LABEL[d.status]}</>}
                                  {/* Said plainly, in the row's own subtitle: an
                                      override is otherwise invisible until you
                                      open their write-up and wonder why it looks
                                      different from everyone else's. */}
                                  {r.formSource === 'enrollment' && <> · Own form</>}
                                </span>
                              </span>
                            </button>

                            {/* Trailing actions — hidden in select mode */}
                            {!selectMode && <>
                              <button type="button" onClick={() => setNotesFor(r.enrollmentId)} aria-label="Write up notes" className={`mr-2 flex-shrink-0 rounded-lg p-2 active:bg-slate-100 ${r.hasReport ? 'text-emerald-600' : 'text-slate-300'}`}>
                                <ClipboardCheck className="h-[18px] w-[18px]" strokeWidth={1.75} />
                              </button>
                            </>}
                          </div>

                        </div>
                      )
                    })}
                  </FlatBlock>

                  {/* Homework for the whole class, in one tap. The offering's
                      defaults for this session number, handed to every dog on
                      the register at once — the only way class homework can be
                      set. Silent when the offering has no defaults.

                      Who is pre-ticked comes from SAVED attendance, so mark and
                      save the register first if someone didn't turn up. */}
                  {/* What this week covers, when the class runs a curriculum,
                      read-only: a cohort works through it together, so there is
                      no step to move for one dog. Sits directly over the
                      homework because they are the same thought — step 2 is
                      loose-lead, and this is what they practise afterwards. */}
                  <div>
                    <SectionLabel>Homework</SectionLabel>
                    <div className="flex flex-col gap-3">
                      <SessionSeriesStep sessionId={sessionId} />
                      <SuggestedHomework sessionId={sessionId} />
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Pinned bottom action bar — BOTH phases now. The write-up's Save and
          Back used to sit at the end of a form longer than the phone, so you
          scrolled past every question to reach them; they're here instead.
          bottom-0, not bottom-[4rem+inset]: it used to hold itself clear of the
          five tabs, and the screen is immersive now so there are none. It owns
          the floor, and pads the home indicator itself. */}
      {data && (notesRow || data.roster.length > 0) && (
        <div className="sticky inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
          <div
            className="mx-auto w-full max-w-2xl px-4 pt-3 md:px-6"
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
          >
            {notesRow ? (
              /* Writing up one client. Back sits on the left as the way out,
                 Save on the right where the primary action always is. */
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={() => setNotesFor(null)}>Back</Button>
                <Button onClick={() => saveNotes(notesRow.enrollmentId)} loading={saving}>Save notes</Button>
              </div>
            ) : selectMode ? (
              <div className="flex items-center justify-between gap-3">
                <span className="whitespace-nowrap text-sm text-slate-500"><span className="font-semibold text-slate-700">{selected.size}</span> selected</span>
                <Button onClick={() => setBulkPicker(true)} disabled={selected.size === 0}>Mark as…</Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-500">
                  {saved ? <span className="font-medium text-emerald-600">{saved}</span> : <><span className="font-semibold text-slate-700">{presentCount}</span>/{data.roster.length} present</>}
                </span>
                <Button onClick={saveAttendance} loading={saving}>Save attendance</Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Full screens, not dropdowns ─────────────────────────────────── */}

      {formPicker && data && (
        <ChoiceScreen
          title="Write-up form"
          sub="Used for every client's notes on this session"
          activeId={formId || 'none'}
          options={[
            { id: 'none', label: 'No form', sub: 'Just a recap message per client' },
            ...data.availableForms.map(f => ({
              id: f.id,
              label: f.name,
              sub: `${f.questions.length} question${f.questions.length === 1 ? '' : 's'}`,
            })),
          ]}
          onPick={id => { setFormId(id === 'none' ? '' : id); setFormPicker(false) }}
          onClose={() => setFormPicker(false)}
        />
      )}

      {/* One client's own form. "Same as the class" is the first choice and the
          usual answer — the override is the exception, so it reads as stepping
          away from the default rather than as a blank to fill in. */}
      {pickerRow && data && (
        <ChoiceScreen
          title={pickerRow.clientName}
          sub="Which form their notes use"
          activeId={pickerRow.ownFormId ?? 'default'}
          options={[
            {
              id: 'default',
              label: 'Same as the rest of the class',
              sub: data.effectiveForm ? data.effectiveForm.name : 'No form — recap only',
            },
            ...data.availableForms.map(f => ({
              id: f.id,
              label: f.name,
              sub: `${f.questions.length} question${f.questions.length === 1 ? '' : 's'}`,
            })),
          ]}
          onPick={id => {
            const enrollmentId = pickerRow.enrollmentId
            setOwnFormPicker(null)
            void setOwnForm(enrollmentId, id === 'default' ? null : id)
          }}
          onClose={() => setOwnFormPicker(null)}
        />
      )}

      {menuRow && (
        <ChoiceScreen
          title={menuRow.clientName}
          sub={menuRow.dogName ?? undefined}
          activeId={draft[menuRow.enrollmentId]?.status}
          options={ALL_STATUSES.map(s => ({ id: s, label: STATUS_LABEL[s] }))}
          onPick={s => { setStatus(menuRow.enrollmentId, s as AttStatus); setMenuFor(null) }}
          onClose={() => setMenuFor(null)}
        />
      )}

      {bulkPicker && (
        <ChoiceScreen
          title="Mark as…"
          sub={`${selected.size} selected`}
          options={ALL_STATUSES.map(s => ({ id: s, label: STATUS_LABEL[s] }))}
          onPick={s => { applyToSelected(s as AttStatus); setBulkPicker(false) }}
          onClose={() => setBulkPicker(false)}
        />
      )}
    </>
  )
}
