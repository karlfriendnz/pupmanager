'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { compressImageFile } from '@/lib/compress-image'

interface Props {
  dogId: string | null      // null = unsaved dog; UI is disabled
  dogName?: string
  initialPhotoUrl: string | null
  onChange?: (url: string | null) => void
}

// Shared photo uploader for dog records. Used from both the client's
// /my-profile and the trainer's /clients/[id]/edit forms. Hits a single
// endpoint that handles role-based authorisation.
export function DogPhotoUpload({ dogId, dogName, initialPhotoUrl, onChange }: Props) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(initialPhotoUrl)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function upload(file: File) {
    if (!dogId) return
    setError(null)
    setUploading(true)
    try {
      // Downscale large phone photos client-side — the server route reads the
      // file through a serverless function whose request body caps at ~4.5 MB.
      const toSend = await compressImageFile(file)
      const fd = new FormData()
      fd.append('file', toSend)
      const res = await fetch(`/api/dogs/${dogId}/photo`, { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Upload failed')
        return
      }
      setPhotoUrl(body.photoUrl)
      onChange?.(body.photoUrl)
    } finally {
      setUploading(false)
    }
  }

  async function remove() {
    if (!dogId) return
    setError(null)
    setUploading(true)
    try {
      const res = await fetch(`/api/dogs/${dogId}/photo`, { method: 'DELETE' })
      if (res.ok) {
        setPhotoUrl(null)
        onChange?.(null)
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-slate-700">Photo</label>
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 rounded-2xl border border-slate-200 bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center overflow-hidden flex-shrink-0">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={dogName ?? 'Dog photo'} className="h-full w-full object-cover" />
          ) : (
            <span className="text-3xl">🐕</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {!dogId ? (
            <p className="text-xs text-slate-400">Save the dog first to add a photo.</p>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
              >
                {uploading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Uploading…</>
                  : <><ImagePlus className="h-3.5 w-3.5 mr-1.5" />{photoUrl ? 'Replace photo' : 'Upload photo'}</>}
              </Button>
              {photoUrl && !uploading && (
                <button
                  type="button"
                  onClick={remove}
                  className="text-xs text-slate-400 hover:text-red-500 self-start flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              )}
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) upload(f)
              e.target.value = ''
            }}
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
