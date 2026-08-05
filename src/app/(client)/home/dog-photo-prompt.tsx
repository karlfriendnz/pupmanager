'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Loader2 } from 'lucide-react'

import { compressImageFile } from '@/lib/compress-image'

/**
 * One upload path for the dog's photo, shared by whatever asks for it.
 *
 * Compression is not optional: the route reads the file through a serverless
 * function whose request body caps at ~4.5 MB, and a photo straight off a phone
 * clears that on its own.
 */
function useDogPhotoUpload(dogId: string) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const toSend = await compressImageFile(file)
      const fd = new FormData()
      fd.append('file', toSend)
      const res = await fetch(`/api/dogs/${dogId}/photo`, { method: 'POST', body: fd })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Upload failed — try a different image.')
        return
      }
      // Data-driven: the home re-renders with photoUrl set, the hero shows the
      // photo, and this invitation stops existing.
      router.refresh()
    } finally {
      setUploading(false)
    }
  }

  return { inputRef, uploading, error, onPick, open: () => inputRef.current?.click() }
}

/**
 * The empty hero IS the invitation.
 *
 * With no gallery and no photo, the hero was a flat panel of the trainer's
 * colour with a dog outline on it — a dead 300px that said nothing and did
 * nothing, while a separate card underneath asked for the same photo. So the
 * panel itself became the button (Karl, 2026-08-06: "if no image here put a
 * transparent button to say upload image") and the card went with it.
 *
 * Transparent by design: the hero already carries its own top and bottom
 * gradients, so the words read against the accent without a second filled
 * surface being introduced on top of it.
 *
 * Only rendered when there IS a dog — with no dog record there is nothing to
 * attach a photo to, and a button that cannot work is worse than no button.
 */
export function DogPhotoHeroPrompt({ dogId, dogName }: { dogId: string; dogName: string }) {
  const { inputRef, uploading, error, onPick, open } = useDogPhotoUpload(dogId)

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={uploading}
        className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pb-16 text-white disabled:opacity-70"
        style={{ textShadow: '0 1px 14px rgba(0,0,0,0.55)' }}
      >
        {uploading
          ? <Loader2 className="h-8 w-8 animate-spin" strokeWidth={1.75} />
          : <Camera className="h-8 w-8" strokeWidth={1.75} />}
        <span className="text-sm font-semibold">
          {uploading ? 'Uploading…' : `Upload a photo of ${dogName}`}
        </span>
        {error && <span className="px-6 text-center text-xs font-medium text-white/90">{error}</span>}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
    </>
  )
}
