'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Loader2, X } from 'lucide-react'
import { resizeImageFile } from '@/lib/resize-image'

// Shown on the client home when their dog has no photo yet — a gentle nudge to
// add one. Data-driven: once a photo is uploaded, router.refresh() re-renders
// the home with photoUrl set and the prompt disappears (so it naturally stops
// showing). Dismiss only hides it for the current view.
export function DogPhotoPrompt({ dogId, dogName }: { dogId: string; dogName: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const toSend = await resizeImageFile(file)
      const fd = new FormData()
      fd.append('file', toSend)
      const res = await fetch(`/api/dogs/${dogId}/photo`, { method: 'POST', body: fd })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Upload failed — try a different image.')
        return
      }
      router.refresh()
    } finally {
      setUploading(false)
    }
  }

  if (dismissed) return null

  return (
    <section className="px-4">
      <div className="relative flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="absolute right-2.5 top-2.5 text-slate-300 hover:text-slate-500"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Camera className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1 pr-4">
          <p className="text-sm font-semibold text-slate-900">Add a photo of {dogName}</p>
          <p className="mt-0.5 text-xs text-slate-500">Make their training space feel like home.</p>
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
          style={{ backgroundImage: 'linear-gradient(135deg,var(--accent),var(--accent-strong))' }}
        >
          {uploading ? <><Loader2 className="h-4 w-4 animate-spin" />Uploading…</> : 'Add photo'}
        </button>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
      </div>
    </section>
  )
}
