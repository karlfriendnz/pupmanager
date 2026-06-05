'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '@/components/shared/page-header'
import { ClipboardCheck, ChevronLeft } from 'lucide-react'

const ATT_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'MAKEUP'] as const
type AttStatus = (typeof ATT_STATUSES)[number]

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

  const selectedForm = data?.availableForms.find(f => f.id === formId) ?? null

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
                <div className="overflow-x-auto -mx-2 md:mx-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
                        <th className="py-2 px-3">Client</th>
                        <th className="py-2 px-3">Dog</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3 w-full">Note</th>
                        <th className="py-2 px-3 text-right">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.roster.map(r => {
                        const d = draft[r.enrollmentId]
                        if (!d) return null
                        return (
                          <tr key={r.enrollmentId}>
                            <td className="py-2 px-3 font-medium text-slate-900 whitespace-nowrap">{r.clientName}</td>
                            <td className="py-2 px-3 text-slate-600 whitespace-nowrap">{r.dogName ?? '—'}</td>
                            <td className="py-2 px-3">
                              <select
                                value={d.status}
                                onChange={e => setDraft(p => ({ ...p, [r.enrollmentId]: { ...d, status: e.target.value as AttStatus } }))}
                                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                {ATT_STATUSES.map(s => <option key={s} value={s}>{s.toLowerCase()}</option>)}
                              </select>
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                placeholder="Quick note (optional)"
                                value={d.note}
                                onChange={e => setDraft(p => ({ ...p, [r.enrollmentId]: { ...d, note: e.target.value } }))}
                                className="w-full h-9 rounded-lg border border-slate-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </td>
                            <td className="py-2 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => setNotesFor(r.enrollmentId)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 px-3 h-9 text-xs font-medium text-slate-600 hover:text-blue-700 whitespace-nowrap"
                              >
                                <ClipboardCheck className="h-3.5 w-3.5" />
                                {r.hasReport ? 'Notes ✓' : 'Notes'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
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
