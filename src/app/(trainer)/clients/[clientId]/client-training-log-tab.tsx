'use client'

import { useState } from 'react'
import { Loader2, MessageSquarePlus, Dumbbell } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { VideoPlayer } from '@/components/video-player'

export interface TrainerTrainingLog {
  id: string
  taskId: string
  taskTitle: string
  loggedAt: string // ISO
  note: string | null
  repsDone: number | null
  rating: number | null
  imageUrls: string[]
  videoUrl: string | null
  trainerComment: string | null
}

const RATINGS: Record<number, { emoji: string; label: string }> = {
  1: { emoji: '😣', label: 'Tough' },
  2: { emoji: '😐', label: 'Okay' },
  3: { emoji: '😀', label: 'Great' },
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })
}

// Trainer-side view of a client's recent practice logs across all their homework
// tasks (newest first). Each entry shows what the client recorded and lets the
// trainer leave one comment back — which the client then sees on their homework.
export function ClientTrainingLogTab({ logs: initialLogs }: { logs: TrainerTrainingLog[] }) {
  const [logs, setLogs] = useState(initialLogs)

  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <Dumbbell className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No practice logs yet — they&apos;ll appear here as the client trains.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {logs.map(log => (
        <TrainingLogCard
          key={log.id}
          log={log}
          onCommented={comment => setLogs(prev => prev.map(l => (l.id === log.id ? { ...l, trainerComment: comment } : l)))}
        />
      ))}
    </div>
  )
}

function TrainingLogCard({ log, onCommented }: { log: TrainerTrainingLog; onCommented: (comment: string) => void }) {
  const r = log.rating != null ? RATINGS[log.rating] : null
  const [editing, setEditing] = useState(false)
  const [comment, setComment] = useState(log.trainerComment ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const trimmed = comment.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/tasks/logs/${log.id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: trimmed }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(typeof body.error === 'string' ? body.error : 'Could not save your comment.')
        return
      }
      onCommented(trimmed)
      setEditing(false)
    } catch {
      setError('Could not save your comment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardBody className="py-4">
        <div className="flex items-center gap-2">
          {r && <span className="text-lg leading-none" title={r.label}>{r.emoji}</span>}
          <span className="text-sm font-semibold text-slate-900">{log.taskTitle}</span>
          <span className="text-xs text-slate-400">· {formatWhen(log.loggedAt)}</span>
          {log.repsDone != null && <span className="text-xs text-slate-400">· {log.repsDone} reps</span>}
        </div>

        {log.note && <p className="mt-1.5 text-sm text-slate-600 whitespace-pre-wrap">{log.note}</p>}

        {log.imageUrls.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {log.imageUrls.map((src, idx) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src + idx} src={src} alt="" className="h-16 w-16 rounded-lg object-cover border border-slate-200" />
            ))}
          </div>
        )}

        {log.videoUrl && <VideoPlayer src={log.videoUrl} className="mt-2 max-w-sm" />}

        {/* Trainer comment — saved reply, or an inline composer */}
        {log.trainerComment && !editing ? (
          <div className="mt-3 rounded-xl bg-blue-50 border border-blue-100 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-500">Your reply</p>
            <p className="mt-0.5 text-sm text-slate-700 whitespace-pre-wrap">{log.trainerComment}</p>
            <button onClick={() => setEditing(true)} className="mt-1.5 text-xs font-medium text-blue-600 hover:underline">
              Edit
            </button>
          </div>
        ) : editing ? (
          <div className="mt-3">
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Reply to your client…"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
            <div className="mt-1.5 flex gap-2">
              <button
                onClick={save}
                disabled={!comment.trim() || saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {saving ? 'Saving…' : 'Send reply'}
              </button>
              <button
                onClick={() => { setEditing(false); setComment(log.trainerComment ?? ''); setError(null) }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" /> Reply
          </button>
        )}
      </CardBody>
    </Card>
  )
}
