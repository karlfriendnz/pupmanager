'use client'

import { useEffect, useRef, useState } from 'react'
import { Trash2, Plus, Play, Loader2 } from 'lucide-react'
import { compressImageFile } from '@/lib/compress-image'

interface Media { id: string; kind: 'IMAGE' | 'VIDEO'; url: string; thumbnailUrl: string | null; caption: string | null; order: number }

// Trainer-side manager for a dog's gallery (shown in the client app hero).
// Images upload via /api/upload/image then POST the URL to the dog media API.
export function DogGalleryManager({ dogId }: { dogId: string }) {
  const [media, setMedia] = useState<Media[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/dogs/${dogId}/media`)
      .then(r => (r.ok ? r.json() : { media: [] }))
      .then(d => { if (alive) { setMedia(d.media ?? []); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [dogId])

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const toSend = await compressImageFile(file)
      const fd = new FormData()
      fd.append('file', toSend)
      const up = await fetch('/api/upload/image', { method: 'POST', body: fd })
      if (!up.ok) throw new Error('upload failed')
      const { url } = await up.json()
      const res = await fetch(`/api/dogs/${dogId}/media`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'IMAGE', url }),
      })
      if (!res.ok) throw new Error('save failed')
      const { media: created } = await res.json()
      setMedia(prev => [...prev, created])
    } catch {
      alert('Upload failed. Make sure a Vercel Blob store is connected.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remove(id: string) {
    setMedia(prev => prev.filter(m => m.id !== id))
    await fetch(`/api/dogs/${dogId}/media/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Gallery</p>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="text-xs font-semibold text-teal-600 hover:text-teal-700 inline-flex items-center gap-1 disabled:opacity-50">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add photo
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
      </div>
      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : media.length === 0 ? (
        <p className="text-xs text-slate-400">No gallery photos yet — add some and they’ll appear as the hero on this dog’s home screen.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {media.map(m => (
            <div key={m.id} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.kind === 'VIDEO' ? (m.thumbnailUrl ?? m.url) : m.url} alt="" className="h-full w-full object-cover" />
              {m.kind === 'VIDEO' && <span className="absolute inset-0 flex items-center justify-center"><Play className="h-6 w-6 text-white drop-shadow" fill="currentColor" /></span>}
              <button type="button" onClick={() => remove(m.id)} aria-label="Remove" className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
