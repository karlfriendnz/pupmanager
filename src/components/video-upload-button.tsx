'use client'

import { useRef, useState } from 'react'
import { upload } from '@vercel/blob/client'
import { Video as VideoIcon, Loader2, X } from 'lucide-react'

// Record/upload a video and hand back its PUBLIC blob URL — the same
// direct-to-Blob pipeline the trainer's session notes use (compression-free,
// bypasses the serverless body limit, handles 100 MB phone clips). `capture`
// lets the native picker record straight from the camera. Playback is just
// <video src={url}> (see VideoPlayer) — no signing layer, the URL is unguessable
// (Blob's random suffix). `handleUploadUrl` authorises the upload per task.
const MAX_BYTES = 100 * 1024 * 1024

function safeName(name: string) {
  const clean = (name || 'clip').replace(/[^\w.-]+/g, '_').slice(-80)
  return /\.\w{2,4}$/.test(clean) ? clean : `${clean}.mp4`
}

export function VideoUploadButton({
  taskId,
  onUploaded,
  className = '',
}: {
  taskId: string
  onUploaded: (url: string) => void
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pick(files: FileList | null) {
    const file = files?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    setError(null)
    if (!file.type.startsWith('video/')) { setError('That doesn’t look like a video.'); return }
    if (file.size > MAX_BYTES) { setError('Video is too large (max 100 MB).'); return }

    setProgress(0)
    try {
      const blob = await upload(safeName(file.name), file, {
        access: 'public',
        handleUploadUrl: `/api/tasks/${taskId}/video-upload`,
        clientPayload: JSON.stringify({ sizeBytes: file.size }),
        onUploadProgress: (p) => setProgress(Math.round(p.percentage)),
      })
      onUploaded(blob.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed — please try again.')
    } finally {
      setProgress(null)
    }
  }

  const uploading = progress !== null

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-60"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <VideoIcon className="h-4 w-4" />}
        {uploading ? `Uploading… ${progress}%` : 'Add a video'}
      </button>
      {uploading && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-rose-600">
          <X className="h-3 w-3" /> {error}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        capture="environment"
        onChange={e => pick(e.target.files)}
        className="hidden"
      />
    </div>
  )
}
