'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { ModalPortal } from '@/components/shared/modal-portal'
import { PlaceAutocomplete } from '@/components/maps/place-autocomplete'
import { ImageUploadButton } from '@/components/image-uploader'

// Quick-add a reusable location from within a creation form (the "+" beside the
// location dropdown), so you don't have to leave and go to Settings. Same
// fields as the Locations library: name, Google address, image, description.
// The image comes back with it: a location added mid-form should show the
// picture you just gave it, not wait for a page reload to find out it has one.
export type CreatedLocation = { id: string; name: string; address: string | null; imageUrl: string | null }

export function AddLocationModal({
  region,
  onClose,
  onCreated,
}: {
  region?: string
  onClose: () => void
  onCreated: (loc: CreatedLocation) => void
}) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!name.trim()) { setError('Give the location a name.'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/trainer/locations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), address: address.trim() || null, imageUrl, description: description.trim() || null }),
      })
      if (!res.ok) { setError('Could not save that location.'); return }
      const { location } = await res.json()
      onCreated({ id: location.id, name: location.name, address: location.address, imageUrl: location.imageUrl ?? null })
    } finally {
      setSaving(false)
    }
  }

  const field = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4" onClick={onClose}>
        <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-xl max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
            <h2 className="font-semibold text-slate-900">Add a location</h2>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>

          <div className="p-5 flex flex-col gap-4">
            {error && <p className="text-sm text-rose-600">{error}</p>}

            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Bayfair Reserve" className={field} />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Address <span className="text-slate-400">(optional)</span></label>
              <PlaceAutocomplete
                initialValue={address}
                placeholder="Search an address, or leave blank"
                region={region}
                onTextChange={setAddress}
                onSelect={r => setAddress(r.address)}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Image <span className="text-slate-400">(optional)</span></label>
              {imageUrl ? (
                <div className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl} alt="" className="h-24 w-full max-w-[16rem] rounded-xl object-cover border border-slate-200" />
                  <button type="button" onClick={() => setImageUrl(null)} className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-red-500 flex items-center justify-center shadow-sm" aria-label="Remove image">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <ImageUploadButton onUploaded={urls => { if (urls[0]) setImageUrl(urls[0]) }} />
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Description <span className="text-slate-400">(optional)</span></label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-700">Cancel</button>
            <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Add location'}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
