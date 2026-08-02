'use client'

import { useRef, useState } from 'react'
import { upload } from '@vercel/blob/client'
import { Video as VideoIcon, Loader2, X } from 'lucide-react'

// Record/upload a video and hand back its PUBLIC blob URL — the same
// direct-to-Blob pipeline the trainer's session notes use (compression-free,
// bypasses the serverless body limit, handles 100 MB phone clips). `capture`
// lets the native picker record straight from the camera. Playback is just
// <video src={url}> (see VideoPlayer) — no signing layer, the URL is unguessable
// (Blob's random suffix).
//
// The authorising route is a PROP: a client uploading to their homework log and a
// trainer uploading to a library item are different people with different
// ownership checks, and the button shouldn't know which it's serving.
const MAX_BYTES = 100 * 1024 * 1024

function safeName(name: string) {
  const clean = (name || 'clip').replace(/[^\w.-]+/g, '_').slice(-80)
  return /\.\w{2,4}$/.test(clean) ? clean : `${clean}.mp4`
}

export function VideoUploadButton({
  uploadUrl,
  onUploaded,
  label = 'Add a video',
  hint,
  className = '',
}: {
  /**
   * The route that authorises this upload. Passed in rather than derived, because
   * "who may upload here" differs per surface: a CLIENT uploading to their own
   * homework task, a TRAINER uploading to their own library item. Each has its own
   * ownership check and its own role, and neither can be inferred from an id.
   */
  uploadUrl: string
  onUploaded: (url: string) => void
  /** Button text — "Add a video" reads oddly next to a field already called Video. */
  label?: string
  /**
   * A quiet note beside the button — what makes a good clip here. Opt-in per
   * caller: what's worth saying to a trainer filming a demo isn't what's worth
   * saying to a client logging their practice.
   */
  hint?: string
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
        handleUploadUrl: uploadUrl,
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
      {/* The hint sits BESIDE the button and wraps under it in a narrow column,
          rather than taking a line of its own on every screen. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <VideoIcon className="h-4 w-4" />}
          {uploading ? `Uploading… ${progress}%` : label}
        </button>
        {hint && !uploading && <span className="text-[13px] text-slate-500">{hint}</span>}
      </div>
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
