'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '@/components/shared/page-header'
import { ClipboardCheck, ChevronLeft, ChevronDown, Check, X, StickyNote } from 'lucide-react'

type AttStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'MAKEUP'

const STATUS_META: Record<AttStatus, { label: string; row: string; badge: string; text: string }> = {
  PRESENT:  { label: 'Present',  row: '',             badge: 'bg-emerald-500', text: 'text-emerald-600' },
  ABSENT:   { label: 'Absent',   row: 'bg-slate-50',  badge: 'bg-slate-400',   text: 'text-slate-500' },
  LATE:     { label: 'Late',     row: 'bg-amber-50',  badge: 'bg-amber-500',   text: 'text-amber-600' },
  EXCUSED:  { label: 'Excused',  row: 'bg-sky-50',    badge: 'bg-sky-500',     text: 'text-sky-600' },
  MAKEUP:   { label: 'Makeup',   row: 'bg-violet-50', badge: 'bg-violet-500',  text: 'text-violet-600' },
}
const ALL_STATUSES: AttStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'MAKEUP']

type FormQuestion = { id: string; type: string; label?: string }
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
}
type AttendanceData = {
  sessionFormId: string | null
  effectiveForm: FormLite | null
  availableForms: FormLite[]
  roster: RosterRow[]
}
type ClientDraft = { status: AttStatus; note: string; answers: Record<string, string>; recap: string }

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'
}

// Dog avatar (photo or initials) with a status badge — the at-a-glance signal.
function StatusAvatar({ name, photoUrl, status }: { name: string; photoUrl: string | null; status: AttStatus }) {
  const meta = STATUS_META[status]
  const absent = status === 'ABSENT'
  return (
    <span className="relative flex-shrink-0">
      <span className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-500 ${absent ? 'opacity-40 grayscale' : ''}`}>
        {photoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          : initialsOf(name)}
      </span>
      <span className={`absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white ring-2 ring-white ${meta.badge}`}>
        {status === 'PRESENT' ? <Check className="h-2.5 w-2.5" /> : status === 'ABSENT' ? <X className="h-2.5 w-2.5" /> : null}
      </span>
    </span>
  )
}

// The class session screen. Two phases at different times:
//   1) Attendance — tap to mark present/absent, hold for the status menu.
//   2) Notes — later, write up each client's form.
export function SessionView({
  runId,
  sessionId,
  runName,
  sessionTitle,
  sessionScheduledAt,
}: {
  runId: string
  sessionId: string
  runName: string
  sessionTitle: string
  sessionScheduledAt: string
}) {
  const [data, setData] = useState<AttendanceData | null>(null)
  const [formId, setFormId] = useState('')
  const [draft, setDraft] = useState<Record<string, ClientDraft>>({})
  const [notesFor, setNotesFor] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState<Set<string>>(new Set())
  const [menuFor, setMenuFor] = useState<string | null>(null)
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
      note: r.note ?? '',
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
      const records = data.roster.map(r => ({ enrollmentId: r.enrollmentId, status: draft[r.enrollmentId].status, note: draft[r.enrollmentId].note.trim() || null }))
      const ok = await put({ sessionFormId: formId || null, records })
      if (!ok) { setError('Could not save attendance.'); return }
      setSaved('Attendance saved'); setTimeout(() => setSaved(null), 2000)
    } finally { setSaving(false) }
  }

  async function saveNotes(enrollmentId: string) {
    const d = draft[enrollmentId]
    setSaving(true); setError(null)
    try {
      const ok = await put({ sessionFormId: formId || null, records: [{ enrollmentId, report: { formId: formId || null, answers: d.answers, closing: d.recap.trim() || null } }] })
      if (!ok) { setError('Could not save the notes.'); return }
      setNotesFor(null); setSaved('Notes saved'); await load(); setTimeout(() => setSaved(null), 2000)
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
  function toggleNote(id: string) {
    setNoteOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  // Quick tap = present/absent; press-and-hold = status menu.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  function startPress(id: string) {
    longPressed.current = false
    pressTimer.current = setTimeout(() => { longPressed.current = true; setMenuFor(id) }, 450)
  }
  function endPress() { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null } }
  function rowTap(id: string) {
    if (longPressed.current) { longPressed.current = false; return }
    toggleStatus(id)
  }

  const notesRow = notesFor ? data?.roster.find(r => r.enrollmentId === notesFor) ?? null : null
  const presentCount = data ? data.roster.filter(r => draft[r.enrollmentId]?.status === 'PRESENT').length : 0

  return (
    <>
      <PageHeader
        title={sessionTitle}
        subtitle={new Date(sessionScheduledAt).toLocaleString()}
        actions={
          <Link href={`/classes/${runId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
            <ChevronLeft className="h-4 w-4" /> {runName}
          </Link>
        }
      />

      <div className="w-full max-w-xl mx-auto px-4 pt-4 pb-28">
        {error && <Alert variant="error" className="mb-3">{error}</Alert>}

        {!data ? (
          <p className="text-sm text-slate-500 py-12 text-center">Loading…</p>

        ) : notesRow ? (
          /* ─── Notes phase: write up one client ─── */
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 p-4 flex flex-col gap-3">
            <button onClick={() => setNotesFor(null)} className="self-start inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700">
              <ChevronLeft className="h-3.5 w-3.5" /> Back to attendance
            </button>
            <div className="flex items-center gap-3">
              <StatusAvatar name={notesRow.clientName} photoUrl={notesRow.dogPhotoUrl} status={draft[notesRow.enrollmentId].status} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{notesRow.clientName}</p>
                {notesRow.dogName && <p className="text-xs text-slate-400 truncate">{notesRow.dogName}{notesRow.dogBreed ? ` · ${notesRow.dogBreed}` : ''}</p>}
              </div>
            </div>
            {!selectedForm && <p className="text-xs text-slate-400">No form set for this session — pick one in the attendance view, or just write a recap below.</p>}
            {selectedForm?.questions.map(q => {
              const label = q.label ?? 'Field'
              const val = draft[notesRow.enrollmentId].answers[q.id] ?? ''
              const isLong = q.type === 'LONG_TEXT'
              const isNum = q.type === 'NUMBER' || q.type === 'RATING_1_5'
              return (
                <label key={q.id} className="block">
                  <span className="text-[11px] font-medium text-slate-500">{label}</span>
                  {isLong
                    ? <textarea rows={3} value={val} onChange={e => setAnswer(notesRow.enrollmentId, q.id, e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    : <input type={isNum ? 'number' : 'text'} value={val} onChange={e => setAnswer(notesRow.enrollmentId, q.id, e.target.value)} className="mt-1 w-full h-10 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />}
                </label>
              )
            })}
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500">Recap message for the client (optional)</span>
              <textarea rows={3} value={draft[notesRow.enrollmentId].recap} onChange={e => setDraft(p => ({ ...p, [notesRow.enrollmentId]: { ...p[notesRow.enrollmentId], recap: e.target.value } }))} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
            <div className="flex gap-2 pt-1">
              <Button onClick={() => saveNotes(notesRow.enrollmentId)} loading={saving}>Save notes</Button>
              <Button variant="ghost" onClick={() => setNotesFor(null)}>Back</Button>
            </div>
          </div>

        ) : (
          /* ─── Attendance phase ─── */
          <>
            {/* Form for this session — a quiet inline control */}
            <div className="flex items-center gap-2 mb-3 text-sm">
              <span className="text-slate-400">Form</span>
              <select value={formId} onChange={e => setFormId(e.target.value)} className="flex-1 h-9 rounded-xl bg-white px-3 text-sm text-slate-700 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">No form</option>
                {data.availableForms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>

            {data.roster.length === 0 ? (
              <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 p-10 text-center text-sm text-slate-500">No enrolled clients to mark.</div>
            ) : (
              <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 overflow-hidden divide-y divide-slate-100">
                {data.roster.map(r => {
                  const d = draft[r.enrollmentId]
                  if (!d) return null
                  const meta = STATUS_META[d.status]
                  const present = d.status === 'PRESENT'
                  const showNote = noteOpen.has(r.enrollmentId) || !!d.note
                  return (
                    <div key={r.enrollmentId} className={`relative ${meta.row}`}>
                      <div className="flex items-center">
                        {/* Tap = present/absent · hold = status menu */}
                        <button
                          type="button"
                          onClick={() => rowTap(r.enrollmentId)}
                          onPointerDown={() => startPress(r.enrollmentId)}
                          onPointerUp={endPress}
                          onPointerLeave={endPress}
                          onPointerMove={endPress}
                          className="flex items-center gap-3 flex-1 min-w-0 text-left px-3 py-2 active:opacity-70 select-none"
                        >
                          <StatusAvatar name={r.clientName} photoUrl={r.dogPhotoUrl} status={d.status} />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-slate-900 truncate">{r.clientName}</span>
                            <span className="block text-xs text-slate-400 truncate">
                              {r.dogName ?? '—'}
                              {!present && <span className={`font-medium ${meta.text}`}> · {meta.label}</span>}
                            </span>
                          </span>
                        </button>

                        {/* Trailing actions — borderless, muted */}
                        <button type="button" onClick={() => setMenuFor(menuFor === r.enrollmentId ? null : r.enrollmentId)} aria-label="Set status" className="flex-shrink-0 p-2 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-100">
                          <ChevronDown className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => toggleNote(r.enrollmentId)} title="Quick note" className={`flex-shrink-0 p-2 rounded-lg hover:bg-slate-100 ${d.note ? 'text-blue-500' : 'text-slate-300 hover:text-slate-600'}`}>
                          <StickyNote className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => setNotesFor(r.enrollmentId)} title="Write up notes" className={`flex-shrink-0 p-2 mr-1 rounded-lg hover:bg-slate-100 ${r.hasReport ? 'text-emerald-500' : 'text-slate-300 hover:text-slate-600'}`}>
                          <ClipboardCheck className="h-4 w-4" />
                        </button>
                      </div>

                      {showNote && (
                        <div className="pl-[3.75rem] pr-3 pb-2">
                          <input
                            type="text"
                            placeholder="Quick note (optional)"
                            value={d.note}
                            autoFocus={noteOpen.has(r.enrollmentId) && !d.note}
                            onChange={e => setDraft(p => ({ ...p, [r.enrollmentId]: { ...d, note: e.target.value } }))}
                            className="w-full h-9 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      )}

                      {menuFor === r.enrollmentId && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                          <div className="absolute right-3 top-12 z-20 w-40 rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 py-1">
                            {ALL_STATUSES.map(s => {
                              const m = STATUS_META[s]
                              return (
                                <button key={s} type="button" onClick={() => { setStatus(r.enrollmentId, s); setMenuFor(null) }} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50">
                                  <span className={`h-2.5 w-2.5 rounded-full ${m.badge}`} />
                                  <span className={d.status === s ? `${m.text} font-medium` : 'text-slate-700'}>{m.label}</span>
                                  {d.status === s && <Check className="h-3.5 w-3.5 ml-auto text-slate-400" />}
                                </button>
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Pinned bottom action bar (attendance phase) */}
      {data && !notesRow && data.roster.length > 0 && (
        <div className="sticky bottom-0 inset-x-0 border-t border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
          <div className="w-full max-w-xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-sm text-slate-500">
              {saved ? <span className="text-emerald-600 font-medium">{saved}</span> : <><span className="font-semibold text-slate-700">{presentCount}</span>/{data.roster.length} present</>}
            </span>
            <Button onClick={saveAttendance} loading={saving}>Save attendance</Button>
          </div>
        </div>
      )}
    </>
  )
}
