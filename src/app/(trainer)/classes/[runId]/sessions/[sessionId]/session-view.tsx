'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '@/components/shared/page-header'
import { ClipboardCheck, ChevronLeft, Check, X, StickyNote } from 'lucide-react'

type AttStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'MAKEUP'

// Visual treatment per status. Present/Absent are the one-tap toggle; the rest
// are the "exceptions" set via the small picker.
const STATUS_META: Record<AttStatus, { label: string; row: string; dot: string; text: string }> = {
  PRESENT:  { label: 'Present',  row: '',             dot: 'bg-emerald-500 text-white', text: 'text-emerald-700' },
  ABSENT:   { label: 'Absent',   row: 'bg-slate-50',  dot: 'bg-slate-300 text-white',   text: 'text-slate-500' },
  LATE:     { label: 'Late',     row: 'bg-amber-50',  dot: 'bg-amber-500 text-white',   text: 'text-amber-700' },
  EXCUSED:  { label: 'Excused',  row: 'bg-sky-50',    dot: 'bg-sky-500 text-white',     text: 'text-sky-700' },
  MAKEUP:   { label: 'Makeup',   row: 'bg-violet-50', dot: 'bg-violet-500 text-white',  text: 'text-violet-700' },
}
const EXCEPTION_STATUSES: AttStatus[] = ['LATE', 'EXCUSED', 'MAKEUP']

type FormQuestion = { id: string; type: string; label?: string }
type FormLite = { id: string; name: string; questions: FormQuestion[] }
type RosterRow = {
  enrollmentId: string
  clientName: string
  dogName: string | null
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

// The class session page. Two phases that happen at different times:
//   1) Attendance — mark each enrolled client present/absent + a quick note.
//   2) Notes — later, click a client's "Notes" to open the session form and
//      write up their report.
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
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/class-runs/${runId}/sessions/${sessionId}/attendance`)
    if (!res.ok) {
      setError('Could not load the session.')
      return
    }
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

  const [noteOpen, setNoteOpen] = useState<Set<string>>(new Set())
  const selectedForm = data?.availableForms.find(f => f.id === formId) ?? null

  // Tap toggles Present ⇄ Absent (a special status resets to Present).
  function toggleStatus(enrollmentId: string) {
    setDraft(p => ({ ...p, [enrollmentId]: { ...p[enrollmentId], status: p[enrollmentId].status === 'PRESENT' ? 'ABSENT' : 'PRESENT' } }))
  }
  function setStatus(enrollmentId: string, s: AttStatus) {
    setDraft(p => ({ ...p, [enrollmentId]: { ...p[enrollmentId], status: s } }))
  }

  async function put(body: object): Promise<boolean> {
    const res = await fetch(`/api/class-runs/${runId}/sessions/${sessionId}/attendance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok
  }

  // Phase 1: attendance (status + quick note for everyone).
  async function saveAttendance() {
    if (!data) return
    setSaving(true); setError(null)
    try {
      const records = data.roster.map(r => ({ enrollmentId: r.enrollmentId, status: draft[r.enrollmentId].status, note: draft[r.enrollmentId].note.trim() || null }))
      const ok = await put({ sessionFormId: formId || null, records })
      if (!ok) { setError('Could not save attendance.'); return }
      setSaved('Attendance saved.')
      setTimeout(() => setSaved(null), 2000)
    } finally { setSaving(false) }
  }

  // Phase 2: write up one client's report.
  async function saveNotes(enrollmentId: string) {
    const d = draft[enrollmentId]
    setSaving(true); setError(null)
    try {
      const ok = await put({
        sessionFormId: formId || null,
        records: [{ enrollmentId, report: { formId: formId || null, answers: d.answers, closing: d.recap.trim() || null } }],
      })
      if (!ok) { setError('Could not save the notes.'); return }
      setNotesFor(null)
      setSaved('Notes saved.')
      await load()
      setTimeout(() => setSaved(null), 2000)
    } finally { setSaving(false) }
  }

  function setAnswer(enrollmentId: string, qid: string, value: string) {
    setDraft(p => ({ ...p, [enrollmentId]: { ...p[enrollmentId], answers: { ...p[enrollmentId].answers, [qid]: value } } }))
  }

  const notesRow = notesFor ? data?.roster.find(r => r.enrollmentId === notesFor) ?? null : null

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

      <div className="p-4 md:p-8 w-full">
        {error && <Alert variant="error" className="mb-3">{error}</Alert>}
        {saved && <Alert variant="success" className="mb-3">{saved}</Alert>}

        {!data ? (
          <p className="text-sm text-slate-500 py-10 text-center">Loading session…</p>

        ) : notesRow ? (
          /* ─── Notes phase: write up one client ─── */
          <Card>
            <CardBody className="flex flex-col gap-3">
              <button onClick={() => setNotesFor(null)} className="self-start inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700">
                <ChevronLeft className="h-3.5 w-3.5" /> Back to attendance
              </button>
              <p className="text-sm font-semibold text-slate-900">
                {notesRow.clientName}{notesRow.dogName && <span className="text-slate-500 font-normal"> · {notesRow.dogName}</span>}
              </p>
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
                      ? <textarea rows={3} value={val} onChange={e => setAnswer(notesRow.enrollmentId, q.id, e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      : <input type={isNum ? 'number' : 'text'} value={val} onChange={e => setAnswer(notesRow.enrollmentId, q.id, e.target.value)} className="mt-0.5 w-full h-9 rounded-lg border border-slate-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />}
                  </label>
                )
              })}
              <label className="block">
                <span className="text-[11px] font-medium text-slate-500">Recap message for the client (optional)</span>
                <textarea rows={3} value={draft[notesRow.enrollmentId].recap} onChange={e => setDraft(p => ({ ...p, [notesRow.enrollmentId]: { ...p[notesRow.enrollmentId], recap: e.target.value } }))} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <div className="flex gap-2 pt-1">
                <Button onClick={() => saveNotes(notesRow.enrollmentId)} loading={saving}>Save notes</Button>
                <Button variant="ghost" onClick={() => setNotesFor(null)}>Back</Button>
              </div>
            </CardBody>
          </Card>

        ) : (
          /* ─── Attendance phase: roster ─── */
          <Card>
            <CardBody className="flex flex-col gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">Form for this session</label>
                <select value={formId} onChange={e => setFormId(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">No form</option>
                  {data.availableForms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>

              {data.roster.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">No enrolled clients to mark.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-slate-400">Everyone starts <span className="text-emerald-600 font-medium">present</span> — tap a name to mark absent.</p>
                    <span className="text-xs text-slate-400">{data.roster.filter(x => draft[x.enrollmentId]?.status === 'PRESENT').length}/{data.roster.length} present</span>
                  </div>
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                    {data.roster.map(r => {
                      const d = draft[r.enrollmentId]
                      if (!d) return null
                      const meta = STATUS_META[d.status]
                      const present = d.status === 'PRESENT'
                      const showNote = noteOpen.has(r.enrollmentId) || !!d.note
                      return (
                        <div key={r.enrollmentId} className={meta.row}>
                          <div className="flex items-center gap-1.5 px-2">
                            {/* Tap target: toggles present/absent */}
                            <button
                              type="button"
                              onClick={() => toggleStatus(r.enrollmentId)}
                              className="flex items-center gap-2 flex-1 min-w-0 text-left py-1.5 active:opacity-70"
                            >
                              <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${meta.dot}`}>
                                {present ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                              </span>
                              <span className="text-sm text-slate-900 truncate">
                                {r.clientName}{r.dogName && <span className="text-slate-400"> · {r.dogName}</span>}
                              </span>
                              {!present && <span className={`ml-auto text-[11px] font-medium ${meta.text}`}>{meta.label}</span>}
                            </button>

                            {/* Exceptions picker (Late / Excused / Makeup) */}
                            <select
                              value={EXCEPTION_STATUSES.includes(d.status) ? d.status : ''}
                              onChange={e => e.target.value && setStatus(r.enrollmentId, e.target.value as AttStatus)}
                              className="h-7 rounded-md border border-slate-200 bg-white px-1 text-xs text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 flex-shrink-0"
                              aria-label="Other status"
                            >
                              <option value="">⋯</option>
                              {EXCEPTION_STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                            </select>

                            {/* Quick note (tucked behind an icon) */}
                            <button
                              type="button"
                              onClick={() => setNoteOpen(prev => { const n = new Set(prev); if (n.has(r.enrollmentId)) n.delete(r.enrollmentId); else n.add(r.enrollmentId); return n })}
                              title="Quick note"
                              className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border ${d.note ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-400 hover:text-slate-600'}`}
                            >
                              <StickyNote className="h-3.5 w-3.5" />
                            </button>

                            {/* Write-up (separate phase) */}
                            <button
                              type="button"
                              onClick={() => setNotesFor(r.enrollmentId)}
                              title="Write up notes"
                              className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border ${r.hasReport ? 'border-emerald-300 bg-emerald-50 text-emerald-600' : 'border-slate-200 text-slate-400 hover:text-slate-600'}`}
                            >
                              <ClipboardCheck className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {showNote && (
                            <div className="px-2 pb-1.5 pl-9">
                              <input
                                type="text"
                                placeholder="Quick note (optional)"
                                value={d.note}
                                autoFocus={noteOpen.has(r.enrollmentId) && !d.note}
                                onChange={e => setDraft(p => ({ ...p, [r.enrollmentId]: { ...d, note: e.target.value } }))}
                                className="w-full h-8 rounded-md border border-slate-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              <div className="flex gap-2">
                <Button onClick={saveAttendance} loading={saving}>Save attendance</Button>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  )
}
