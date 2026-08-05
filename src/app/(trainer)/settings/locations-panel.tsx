'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Check, X, MapPin, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ImageUploadButton } from '@/components/image-uploader'
import { PlaceAutocomplete } from '@/components/maps/place-autocomplete'

export type LocationRow = {
  id: string
  name: string
  address: string | null
  imageUrl: string | null
  description: string | null
}

type Draft = {
  id: string | null
  name: string
  address: string
  imageUrl: string | null
  description: string
}

const blankDraft = (): Draft => ({ id: null, name: '', address: '', imageUrl: null, description: '' })

export function LocationsPanel({ locations, region }: { locations: LocationRow[]; region?: string }) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Inline "are you sure?" per row instead of a blocking window.confirm.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const patch = (p: Partial<Draft>) => setDraft(d => (d ? { ...d, ...p } : d))

  function openNew() {
    setError(null)
    setConfirmDelete(null)
    setDraft(blankDraft())
  }

  function openEdit(l: LocationRow) {
    setError(null)
    setConfirmDelete(null)
    setDraft({
      id: l.id,
      name: l.name,
      address: l.address ?? '',
      imageUrl: l.imageUrl,
      description: l.description ?? '',
    })
  }

  async function save() {
    if (!draft) return
    if (!draft.name.trim()) {
      setError('Give the location a name.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const url = draft.id ? `/api/trainer/locations/${draft.id}` : '/api/trainer/locations'
      const res = await fetch(url, {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          address: draft.address.trim() || null,
          imageUrl: draft.imageUrl || null,
          description: draft.description.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(typeof body?.error === 'string' ? body.error : 'Could not save this location.')
      }
      setDraft(null)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this location.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/trainer/locations/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setConfirmDelete(null)
      router.refresh()
    } catch {
      setError('Could not delete this location.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="flex flex-col gap-5 max-w-2xl">
      {/* Existing locations */}
      <div className="flex flex-col gap-3">
        {locations.length === 0 && !draft && (
          <div className="rounded-2xl border border-dashed border-slate-200 grid place-items-center min-h-[160px] text-center text-sm text-slate-400 p-6">
            <div>
              <MapPin className="h-6 w-6 mx-auto mb-2 text-slate-300" />
              No locations yet — add the places you work from so you can pick them later.
            </div>
          </div>
        )}

        {locations.map(l => (
          <div key={l.id} className="rounded-2xl border border-slate-200 bg-white p-4 flex items-start gap-4">
            {l.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.imageUrl} alt="" className="h-14 w-14 rounded-xl object-cover border border-slate-200 flex-shrink-0" />
            ) : (
              <div className="h-14 w-14 rounded-xl bg-slate-50 border border-slate-200 grid place-items-center flex-shrink-0">
                <MapPin className="h-5 w-5 text-slate-300" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 truncate">{l.name}</p>
              {l.address && <p className="text-xs text-slate-500 truncate mt-0.5">{l.address}</p>}
              {l.description && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{l.description}</p>}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {confirmDelete === l.id ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">Delete?</span>
                  <button
                    type="button"
                    onClick={() => remove(l.id)}
                    disabled={deletingId === l.id}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(null)}
                    className="inline-flex items-center rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
                  >
                    No
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => openEdit(l)}
                    aria-label="Edit location"
                    className="h-8 w-8 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(l.id)}
                    aria-label="Delete location"
                    className="h-8 w-8 grid place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add / edit form */}
      {draft ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-slate-900">{draft.id ? 'Edit location' : 'Add location'}</h3>

          {/* htmlFor/id, not a loose <label>: without the association a screen
              reader reads an unnamed box, tapping the label doesn't focus it,
              and the review widget can't name what a comment is pinned to
              (AGENTS.md). Same fix as the client form's fields. */}
          <div>
            <label htmlFor="location-name" className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Name</label>
            <Input
              id="location-name"
              value={draft.name}
              onChange={e => patch({ name: e.target.value })}
              placeholder="The training field"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Address</label>
            <PlaceAutocomplete
              region={region}
              initialValue={draft.address}
              placeholder="Search for an address…"
              onTextChange={text => patch({ address: text })}
              onSelect={r => patch({ address: r.address })}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Image <span className="normal-case font-normal tracking-normal text-slate-400">· optional</span></label>
            {draft.imageUrl ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={draft.imageUrl} alt="" className="h-24 w-full max-w-[16rem] rounded-xl object-cover border border-slate-200" />
                <button
                  type="button"
                  onClick={() => patch({ imageUrl: null })}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-red-500 hover:border-red-200 flex items-center justify-center shadow-sm"
                  aria-label="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <ImageUploadButton onUploaded={urls => { if (urls[0]) patch({ imageUrl: urls[0] }) }} />
                <span className="text-xs text-slate-400">Add a photo of this location.</span>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="location-description" className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Description <span className="normal-case font-normal tracking-normal text-slate-400">· optional</span></label>
            <textarea
              id="location-description"
              value={draft.description}
              onChange={e => patch({ description: e.target.value })}
              rows={3}
              placeholder="Parking round the back, gate code 1234…"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex items-center gap-3 pt-1">
            {/* "Save location", never "Add location" — that was the name of
                the button that OPENED this form as well as the one that
                submits it, so the screen had two different controls answering
                to one name. */}
            <Button type="button" onClick={save} loading={saving}>
              {!saving && <Check className="h-4 w-4" />}
              {draft.id ? 'Save changes' : 'Save location'}
            </Button>
            <button
              type="button"
              onClick={() => { setDraft(null); setError(null) }}
              disabled={saving}
              className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-600 hover:border-accent hover:text-accent transition-colors"
          >
            <Plus className="h-4 w-4" /> Add location
          </button>
        </div>
      )}

      {error && !draft && <p className="text-sm text-rose-600">{error}</p>}
    </section>
  )
}
