'use client'

import { useState, useRef } from 'react'
import { Image as ImageIcon, X, Loader2 } from 'lucide-react'

interface UploadContext {
  sessionId?: string
  taskId?: string
}

/**
 * Compact button that opens the file picker, uploads each selected image to
 * /api/upload/image, and reports back via `onUploaded`. Designed to sit next
 * to the VoiceInput mic — same shape and size.
 *
 * `context` is an optional hint used only for the upload key (sessionId,
 * taskId); never trusted for authorisation.
 */
export function ImageUploadButton({
  onUploaded,
  context,
  className = '',
}: {
  onUploaded: (urls: string[]) => void
  context?: UploadContext
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)
    setUploading(true)
    const added: string[] = []
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      if (context?.sessionId) fd.append('sessionId', context.sessionId)
      if (context?.taskId) fd.append('taskId', context.taskId)
      try {
        const res = await fetch('/api/upload/image', { method: 'POST', body: fd })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setError(body?.error?.toString() ?? 'Upload failed')
          continue
        }
        const { url } = await res.json() as { url: string }
        if (url) added.push(url)
      } catch {
        setError('Upload failed')
      }
    }
    setUploading(false)
    if (added.length > 0) onUploaded(added)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title={uploading ? 'Uploading…' : 'Upload image(s)'}
        aria-label="Upload images"
        className={`flex items-center justify-center h-9 w-9 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${
          uploading
            ? 'bg-blue-500 text-white'
            : 'bg-slate-100 text-slate-500 hover:bg-blue-50 hover:text-blue-600'
        } ${className}`}
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
        {error && <span className="sr-only">{error}</span>}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={e => handleFiles(e.target.files)}
        className="hidden"
      />
    </>
  )
}

/**
 * Thumbnail strip for an existing list of image URLs. Each thumb has a remove
 * "x" overlay on hover. Renders nothing when the list is empty.
 */
export function ImageGallery({
  urls,
  onChange,
  className = '',
}: {
  urls: string[]
  onChange: (urls: string[]) => void
  className?: string
}) {
  if (urls.length === 0) return null
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {urls.map((u, idx) => (
        <div key={u + idx} className="relative group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={u}
            alt=""
            className="h-16 w-16 rounded-lg object-cover border border-slate-200"
          />
          <button
            type="button"
            onClick={() => onChange(urls.filter((_, i) => i !== idx))}
            className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-red-500 hover:border-red-200 flex items-center justify-center shadow-sm"
            aria-label="Remove image"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
