'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, X } from 'lucide-react'
import { ImageUploadButton, ImageGallery } from '@/components/image-uploader'
import { VideoUploadButton } from '@/components/video-upload-button'
import { VideoPlayer } from '@/components/video-player'

export interface TrainingLogEntry {
  id: string
  loggedAt: string
  note: string | null
  repsDone: number | null
  rating: number | null
  imageUrls: string[]
  videoUrl: string | null
  trainerComment: string | null
}

// The "log the training" half of the homework page: a compact form to record one
// practice, above a history of everything logged so far. Logging is additive —
// each save posts a new TrainingLog; the first one also flips the task to done
// (the server owns that), which we reflect with the header pill.
const RATINGS: { value: number; emoji: string; label: string }[] = [
  { value: 1, emoji: '😣', label: 'Tough' },
  { value: 2, emoji: '😐', label: 'Okay' },
  { value: 3, emoji: '😀', label: 'Great' },
]

function formatWhen(iso: string) {
  return new Date(iso).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function TrainingLogPanel({
  taskId,
  initialLogs,
  initiallyDone,
}: {
  taskId: string
  initialLogs: TrainingLogEntry[]
  initiallyDone: boolean
}) {
  const router = useRouter()
  const [logs, setLogs] = useState<TrainingLogEntry[]>(initialLogs)
  const [done, setDone] = useState(initiallyDone)
  const [note, setNote] = useState('')
  const [reps, setReps] = useState('')
  const [rating, setRating] = useState<number | null>(null)
  const [images, setImages] = useState<string[]>([])
  const [video, setVideo] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const empty = !note.trim() && !reps.trim() && rating == null && images.length === 0 && !video

  async function save() {
    if (empty || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/tasks/${taskId}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: note.trim() || undefined,
          repsDone: reps.trim() ? Number(reps) : undefined,
          rating: rating ?? undefined,
          imageUrls: images.length > 0 ? images : undefined,
          videoUrl: video ?? undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Could not save your log. Please try again.')
        return
      }
      setLogs(prev => [body as TrainingLogEntry, ...prev])
      setNote(''); setReps(''); setRating(null); setImages([]); setVideo(null)
      setDone(true)
      // Refresh the server components so the home "This week" ring/checkmark
      // reflects the now-completed task on the way back.
      router.refresh()
    } catch {
      setError('Could not save your log. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Log form */}
      <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-slate-900">Log a session</h2>
          {done && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Done
            </span>
          )}
        </div>

        <label className="mt-3 block text-xs font-semibold text-slate-500">How did it go?</label>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {RATINGS.map(r => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRating(rating === r.value ? null : r.value)}
              className={`flex flex-col items-center gap-1 rounded-2xl border-2 py-2.5 transition-colors ${
                rating === r.value ? 'border-accent bg-accent-soft' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <span className="text-2xl">{r.emoji}</span>
              <span className="text-[11px] font-semibold text-slate-600">{r.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500">Notes</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="How was the practice? Anything to flag for your trainer?"
              className="mt-1.5 w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500">Reps</label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={reps}
              onChange={e => setReps(e.target.value)}
              placeholder="—"
              className="mt-1.5 w-20 rounded-2xl border border-slate-200 px-3 py-2.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        {/* Photos — same uploader (client-side compression) used across the app */}
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-slate-500">Photos</label>
            <ImageUploadButton
              context={{ taskId }}
              onUploaded={urls => setImages(prev => [...prev, ...urls].slice(0, 12))}
            />
          </div>
          <ImageGallery urls={images} onChange={setImages} className="mt-2" />
        </div>

        {/* Video — record or pick a clip; same Blob pipeline as session notes */}
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-slate-500">Video</label>
            {!video && <VideoUploadButton taskId={taskId} onUploaded={setVideo} />}
          </div>
          {video && (
            <div className="mt-2 relative">
              <VideoPlayer src={video} />
              <button
                type="button"
                onClick={() => setVideo(null)}
                aria-label="Remove video"
                className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}

        <button
          type="button"
          onClick={save}
          disabled={empty || saving}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 h-12 rounded-xl bg-accent hover:bg-accent-strong text-white text-base font-semibold disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save log'}
        </button>
      </div>

      {/* History */}
      {logs.length > 0 && (
        <div>
          <p className="px-1 mb-2 text-sm font-semibold text-slate-500">
            Your practice log · {logs.length}
          </p>
          <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden">
            {logs.map((log, i) => {
              const r = RATINGS.find(x => x.value === log.rating)
              return (
                <div key={log.id} className={`px-4 py-3.5 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                  <div className="flex items-center gap-2">
                    {r && <span className="text-lg leading-none">{r.emoji}</span>}
                    <span className="text-sm font-semibold text-slate-800">{formatWhen(log.loggedAt)}</span>
                    {log.repsDone != null && (
                      <span className="text-xs text-slate-400">· {log.repsDone} reps</span>
                    )}
                  </div>
                  {log.note && <p className="mt-1 text-sm text-slate-600 whitespace-pre-wrap">{log.note}</p>}
                  {log.imageUrls.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {log.imageUrls.map((src, idx) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={src + idx} src={src} alt="" className="h-16 w-16 rounded-lg object-cover border border-slate-200" />
                      ))}
                    </div>
                  )}
                  {log.videoUrl && <VideoPlayer src={log.videoUrl} className="mt-2" />}
                  {log.trainerComment && (
                    <div className="mt-2 rounded-2xl bg-accent-soft p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-accent/80">From your trainer</p>
                      <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{log.trainerComment}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
