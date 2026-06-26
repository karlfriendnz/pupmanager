'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Dog, GraduationCap, ChevronRight, Send, Loader2, Check } from 'lucide-react'

export type DraftRow = {
  kind: 'one_to_one' | 'class'
  id: string          // SessionFormResponse id (1:1) or SessionAttendance id (class)
  sessionId: string
  title: string
  scheduledAt: string // ISO
  clientName: string | null
  dogName: string | null
  isClass: boolean
}

// Split a set of selected draft ids into the two payload buckets the
// bulk-send-notes endpoint expects.
function toPayload(rows: DraftRow[]) {
  const responseIds: string[] = []
  const attendanceIds: string[] = []
  for (const r of rows) {
    if (r.kind === 'class') attendanceIds.push(r.id)
    else responseIds.push(r.id)
  }
  return { responseIds, attendanceIds }
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function formatDayLabel(d: Date): string {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const t = new Date(d); t.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - t.getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return t.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'short' })
}

export function DraftNotesList({ rows }: { rows: DraftRow[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const byId = new Map(rows.map(r => [r.id, r]))
  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map(r => r.id)))

  async function send(targets: DraftRow[], markBusy?: () => void, clearBusy?: () => void) {
    if (targets.length === 0) return
    markBusy?.()
    try {
      const res = await fetch('/api/sessions/bulk-send-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toPayload(targets)),
      })
      if (res.ok) { setSelected(new Set()); router.refresh() }
      else alert('Could not send. Please try again.')
    } finally { clearBusy?.() }
  }

  const sendOne = (r: DraftRow) => send(
    [r],
    () => setSending(prev => new Set(prev).add(r.id)),
    () => setSending(prev => { const n = new Set(prev); n.delete(r.id); return n }),
  )
  const sendSelected = () => send(
    [...selected].map(id => byId.get(id)).filter((r): r is DraftRow => !!r),
    () => setBulkBusy(true),
    () => setBulkBusy(false),
  )
  const sendAll = () => send(rows, () => setBulkBusy(true), () => setBulkBusy(false))

  // Group by day, preserving the oldest-first order of `rows`.
  const byDay = new Map<string, { date: Date; rows: DraftRow[] }>()
  for (const r of rows) {
    const dt = new Date(r.scheduledAt); const k = dayKey(dt)
    const g = byDay.get(k); if (g) g.rows.push(r); else byDay.set(k, { date: dt, rows: [r] })
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 cursor-pointer select-none">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-slate-300 accent-teal-600" />
          Select all ({rows.length})
        </label>
        <button
          onClick={sendAll}
          disabled={bulkBusy || rows.length === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 h-10 disabled:opacity-60"
        >
          {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send all ({rows.length})
        </button>
      </div>

      <div className="flex flex-col gap-4 pb-24">
        {Array.from(byDay.values()).map(({ date, rows: dayRows }) => (
          <div key={dayKey(date)}>
            <h3 className="text-[11px] font-semibold text-slate-500 mb-1.5 px-1">{formatDayLabel(date)}</h3>
            <div className="rounded-2xl bg-white border border-slate-100 overflow-hidden">
              {dayRows.map((r, i) => {
                const start = new Date(r.scheduledAt)
                const isSending = sending.has(r.id)
                const isSel = selected.has(r.id)
                return (
                  <div key={r.id} className={`flex items-center gap-2.5 pl-3 pr-3 py-3 transition-colors ${isSel ? 'bg-teal-50/50' : 'hover:bg-slate-50'} ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                    <input
                      type="checkbox" checked={isSel} onChange={() => toggle(r.id)}
                      className="h-4 w-4 rounded border-slate-300 accent-teal-600 flex-shrink-0"
                      aria-label={`Select ${r.title}`}
                    />
                    <Link href={`/sessions/${r.sessionId}`} className="flex-1 min-w-0 flex items-center gap-3">
                      <div className="w-12 flex-shrink-0 text-xs font-semibold text-slate-500 tabular-nums">
                        {start.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </div>
                      <div className="flex-1 min-w-0 flex items-center gap-1.5 text-xs text-slate-500">
                        <p className="text-sm font-semibold text-slate-900 truncate">{r.title}</p>
                        {r.isClass && <span className="inline-flex items-center gap-1 text-teal-600 flex-shrink-0"><GraduationCap className="h-3 w-3" /> Class</span>}
                        {r.dogName && <><span className="text-slate-300 flex-shrink-0">·</span><span className="inline-flex items-center gap-1 flex-shrink-0"><Dog className="h-3 w-3" /> {r.dogName}</span></>}
                        {r.clientName && <><span className="text-slate-300 flex-shrink-0">·</span><span className="truncate">{r.clientName}</span></>}
                      </div>
                    </Link>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => sendOne(r)}
                        disabled={isSending}
                        title="Send this recap to the client"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold pl-2 pr-2.5 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 hover:border-teal-300 transition-colors disabled:opacity-60"
                      >
                        {isSending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        Send
                      </button>
                      <ChevronRight className="h-4 w-4 text-slate-300" />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-3 shadow-[0_-4px_20px_rgba(15,23,42,0.06)]">
          <div className="max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-slate-700">{selected.size} selected</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setSelected(new Set())} disabled={bulkBusy} className="text-sm text-slate-500 hover:text-slate-700 px-3 h-10 disabled:opacity-60">Clear</button>
              <button
                onClick={sendSelected} disabled={bulkBusy}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 h-10 disabled:opacity-60"
              >
                {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Send {selected.size} selected
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
