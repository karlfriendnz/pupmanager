'use client'

import { useState, useRef } from 'react'
import { upload } from '@vercel/blob/client'
import imageCompression from 'browser-image-compression'
import { Camera, Video, Trash2, Loader2, ImageIcon, Play, AlertCircle } from 'lucide-react'

const IMAGE_MAX_BYTES = 10 * 1024 * 1024
const VIDEO_MAX_BYTES = 100 * 1024 * 1024
const VIDEO_MAX_SECONDS = 60 * 5 // 5 minutes — the spec target. Friendly toast,
//                                   not a hard server cap; trainer can re-shoot.

export interface SessionAttachmentItem {
  id: string
  kind: 'IMAGE' | 'VIDEO'
  url: string
  thumbnailUrl: string | null
  caption: string | null
  sizeBytes: number
  durationMs: number | null
  createdAt: string
}

interface Props {
  sessionId: string
  initialAttachments: SessionAttachmentItem[]
}

// Trainer-facing media attachment widget. Two buttons (photo / video),
// each opens the native picker — `capture="environment"` hints to iOS
// to default to the camera over the photo library, but the trainer can
// flip back to the library through the standard picker.
//
// Images run through browser-image-compression (transparent to the
// trainer — happens in the ~200ms between picking and uploading).
// Videos are uploaded as-shot via Vercel Blob's direct-to-Blob client
// upload, which bypasses our serverless function body limit.
export function SessionAttachments({ sessionId, initialAttachments }: Props) {
  const [attachments, setAttachments] = useState(initialAttachments)
  // Active upload: kind currently uploading + 1-based index/total in
  // queue + percentage. Null when idle. Multi-file uploads queue
  // sequentially so we don't overwhelm the user's connection.
  const [uploading, setUploading] = useState<{ kind: 'IMAGE' | 'VIDEO'; progress: number; index: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  async function readVideoMetadata(file: File): Promise<{ durationMs: number; thumbnail: Blob | null }> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true
      video.src = url
      video.onloadedmetadata = () => {
        const durationMs = Math.round((video.duration || 0) * 1000)
        // Seek to t=0.1s so we don't capture a black first frame.
        video.currentTime = Math.min(0.1, (video.duration || 1) - 0.05)
      }
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = Math.min(video.videoWidth, 720)
          canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth)) || 405
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            URL.revokeObjectURL(url)
            resolve({ durationMs: Math.round((video.duration || 0) * 1000), thumbnail: null })
            return
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          canvas.toBlob((blob) => {
            URL.revokeObjectURL(url)
            resolve({ durationMs: Math.round((video.duration || 0) * 1000), thumbnail: blob })
          }, 'image/jpeg', 0.7)
        } catch {
          URL.revokeObjectURL(url)
          resolve({ durationMs: Math.round((video.duration || 0) * 1000), thumbnail: null })
        }
      }
      video.onerror = () => {
        URL.revokeObjectURL(url)
        resolve({ durationMs: 0, thumbnail: null })
      }
    })
  }

  async function uploadOneImage(file: File): Promise<void> {
    if (file.size > IMAGE_MAX_BYTES) {
      throw new Error(`${file.name}: image too large — keep it under 10 MB.`)
    }
    // Compress in JS before upload — invisible to the trainer, brings
    // 12 MP iPhone photos (~5 MB) down to ~1 MB and resizes to 2048px.
    const compressed = await imageCompression(file, {
      maxSizeMB: 2,
      maxWidthOrHeight: 2048,
      useWebWorker: true,
      fileType: 'image/jpeg',
    })
    const blob = await upload(safeName(file.name, 'jpg'), compressed, {
      access: 'public',
      handleUploadUrl: `/api/sessions/${sessionId}/attachments/upload`,
      clientPayload: JSON.stringify({
        kind: 'IMAGE',
        sizeBytes: compressed.size,
      }),
      onUploadProgress: (p) => setUploading(u => u && { ...u, progress: p.percentage }),
    })
    // Vercel's onUploadCompleted webhook only fires in production (it
    // can't reach localhost). Always POST the metadata back so the
    // row gets created in dev too — the endpoint is idempotent on
    // URL so it doesn't double-insert in prod.
    const created = await confirmAttachment(sessionId, {
      kind: 'IMAGE',
      url: blob.url,
      sizeBytes: compressed.size,
    })
    setAttachments(prev => upsert(prev, created))
  }

  async function uploadOneVideo(file: File): Promise<void> {
    if (file.size > VIDEO_MAX_BYTES) {
      throw new Error(`${file.name}: video too large — keep it under 100 MB.`)
    }
    const { durationMs } = await readVideoMetadata(file)
    if (durationMs > VIDEO_MAX_SECONDS * 1000) {
      throw new Error(`${file.name}: video too long — keep it under ${VIDEO_MAX_SECONDS / 60} minutes.`)
    }
    const blob = await upload(safeName(file.name, 'mp4'), file, {
      access: 'public',
      handleUploadUrl: `/api/sessions/${sessionId}/attachments/upload`,
      clientPayload: JSON.stringify({
        kind: 'VIDEO',
        sizeBytes: file.size,
        durationMs,
      }),
      onUploadProgress: (p) => setUploading(u => u && { ...u, progress: p.percentage }),
    })
    const created = await confirmAttachment(sessionId, {
      kind: 'VIDEO',
      url: blob.url,
      sizeBytes: file.size,
      durationMs,
    })
    setAttachments(prev => upsert(prev, created))
  }

  // Sequential queue — uploading in parallel makes the progress bar
  // useless and competes for cellular bandwidth, which on mobile
  // tends to regress all of them. We process one file at a time and
  // collect failures so the trainer sees which ones bombed without
  // the whole batch aborting on the first error.
  async function uploadQueue(files: File[], kind: 'IMAGE' | 'VIDEO'): Promise<void> {
    setError(null)
    const failures: string[] = []
    for (let i = 0; i < files.length; i++) {
      setUploading({ kind, progress: 0, index: i + 1, total: files.length })
      try {
        if (kind === 'IMAGE') await uploadOneImage(files[i])
        else await uploadOneVideo(files[i])
      } catch (err) {
        const msg = err instanceof Error ? err.message : `${files[i].name}: upload failed`
        console.error('[session-attachments]', msg, err)
        failures.push(msg)
      }
    }
    setUploading(null)
    if (failures.length > 0) setError(failures.join(' · '))
    // Final reconcile in case the optimistic state and the DB drifted
    // (e.g. prod webhook fired faster than the client confirm). Cheap
    // and idempotent.
    void refetch()
  }

  async function refetch() {
    try {
      const r = await fetch(`/api/sessions/${sessionId}/attachments`, { cache: 'no-store' })
      if (!r.ok) return
      const data = await r.json() as { attachments: SessionAttachmentItem[] }
      setAttachments(data.attachments)
    } catch { /* keep optimistic state */ }
  }

  async function deleteAttachment(id: string) {
    setPendingDelete(id)
    setError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/attachments/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not delete')
      setAttachments(prev => prev.filter(a => a.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setPendingDelete(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          disabled={uploading !== null}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
        >
          <Camera className="h-4 w-4" /> Add photo
        </button>
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          disabled={uploading !== null}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60"
        >
          <Video className="h-4 w-4" /> Add video
        </button>
        {/* Native pickers — multi-select on. iOS picker has a
            "Take Photo or Video" option at the top of the camera roll,
            so dropping `capture` doesn't lose the camera path; it just
            unlocks multi-pick. */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) void uploadQueue(files, 'IMAGE')
            if (photoInputRef.current) photoInputRef.current.value = ''
          }}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) void uploadQueue(files, 'VIDEO')
            if (videoInputRef.current) videoInputRef.current.value = ''
          }}
        />
      </div>

      {uploading && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 flex items-center gap-3">
          <Loader2 className="h-4 w-4 text-slate-500 animate-spin" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-700">
              {uploading.total > 1
                ? `Uploading ${uploading.kind === 'IMAGE' ? 'photo' : 'video'} ${uploading.index} of ${uploading.total}…`
                : `Uploading ${uploading.kind === 'IMAGE' ? 'photo' : 'video'}…`}
            </p>
            <div className="mt-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all"
                style={{ width: `${Math.round(uploading.progress)}%` }}
              />
            </div>
          </div>
          <span className="text-xs text-slate-500 tabular-nums">{Math.round(uploading.progress)}%</span>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 flex items-center gap-2 text-xs text-red-700">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {attachments.length === 0 ? (
        <p className="text-xs text-slate-400 italic">
          No attachments yet — add a photo or video for this session.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {attachments.map(a => (
            <AttachmentTile
              key={a.id}
              attachment={a}
              onDelete={() => deleteAttachment(a.id)}
              deleting={pendingDelete === a.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AttachmentTile({ attachment: a, onDelete, deleting }: {
  attachment: SessionAttachmentItem
  onDelete: () => void
  deleting: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 group focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {a.kind === 'IMAGE' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.url} alt={a.caption ?? 'Attachment'} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <>
            {a.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.thumbnailUrl} alt={a.caption ?? 'Video thumbnail'} className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-700 to-slate-900">
                <Video className="h-8 w-8 text-white/70" />
              </div>
            )}
            <div className="absolute inset-0 grid place-items-center bg-black/20 group-hover:bg-black/30 transition-colors">
              <div className="grid place-items-center h-10 w-10 rounded-full bg-white/85 text-slate-900">
                <Play className="h-5 w-5" />
              </div>
            </div>
            {a.durationMs !== null && a.durationMs > 0 && (
              <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium tabular-nums">
                {formatDuration(a.durationMs)}
              </span>
            )}
          </>
        )}
        {a.kind === 'IMAGE' && (
          <div className="absolute top-1 left-1 grid place-items-center h-5 w-5 rounded bg-black/30">
            <ImageIcon className="h-3 w-3 text-white" />
          </div>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div className="relative max-w-4xl w-full" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute -top-2 -right-2 grid place-items-center h-8 w-8 rounded-full bg-white text-slate-900 shadow-lg z-10"
              aria-label="Close"
            >
              ×
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); onDelete() }}
              disabled={deleting}
              className="absolute -top-2 left-2 inline-flex items-center gap-1 px-3 h-8 rounded-full bg-red-600 text-white text-xs font-semibold shadow-lg z-10 disabled:opacity-60"
            >
              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Delete
            </button>
            {a.kind === 'IMAGE' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.url} alt={a.caption ?? 'Attachment'} className="max-h-[85vh] w-full object-contain rounded-xl" />
            ) : (
              <video
                src={a.url}
                controls
                playsInline
                autoPlay
                className="max-h-[85vh] w-full rounded-xl bg-black"
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function safeName(original: string, fallbackExt: string): string {
  const cleaned = original.replace(/[^a-zA-Z0-9._-]/g, '_')
  if (cleaned.includes('.')) return cleaned
  return `${cleaned || 'file'}.${fallbackExt}`
}

async function confirmAttachment(
  sessionId: string,
  body: { kind: 'IMAGE' | 'VIDEO'; url: string; sizeBytes: number; durationMs?: number; thumbnailUrl?: string },
): Promise<SessionAttachmentItem> {
  const res = await fetch(`/api/sessions/${sessionId}/attachments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `Could not save attachment (${res.status})`)
  }
  const data = await res.json() as { attachment: SessionAttachmentItem }
  return data.attachment
}

function upsert(list: SessionAttachmentItem[], next: SessionAttachmentItem): SessionAttachmentItem[] {
  const filtered = list.filter(a => a.id !== next.id && a.url !== next.url)
  return [next, ...filtered]
}
