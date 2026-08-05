'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dog as DogIcon, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { BreedSelect } from '@/components/shared/breed-select'
import { DogPhotoUpload } from '@/components/shared/dog-photo-upload'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { DateOfBirthField } from '@/components/shared/date-of-birth-field'
import { dateOfBirthError } from '@/lib/date-of-birth'

/**
 * /my-dogs — the one place a dog owner's dogs live.
 *
 * This screen used to be read-only ("Your dog will show up here once they've
 * been added"), and the only way to add or edit one was a Dogs tab buried in
 * My Profile. That tab is gone; everything it could do moved here — add, edit
 * name/breed/weight/date of birth, the photo uploader, and remove.
 *
 * House style: the form is a FULL SCREEN on a phone (AGENTS.md — full screens,
 * not dropdowns), via the shared FullScreenSheet, which locks body scroll while
 * it is open and carries `no-scrollbar` on its own scroll region so there is
 * never a second scrollbar.
 */
export interface ClientDog {
  id: string
  name: string
  breed: string | null
  photoUrl: string | null
  weight: number | null
  /** ISO yyyy-mm-dd, or null. Serialised on the server so this stays a plain prop. */
  dob: string | null
  deceasedAt: string | null
}

interface DraftDog {
  /** null while the dog has never been saved — the photo uploader needs a real id. */
  id: string | null
  name: string
  breed: string
  weight: string
  dob: string
  photoUrl: string | null
}

const EMPTY: DraftDog = { id: null, name: '', breed: '', weight: '', dob: '', photoUrl: null }

const ageYears = (dob: string | null) =>
  dob ? Math.max(0, Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))) : null

// Kept in step with the zod schema on POST /api/my/dogs and PATCH
// /api/dogs/[dogId]. Both ends check; neither end trusts the other.
const MAX_NAME = 80
const MAX_WEIGHT = 200

export function MyDogsManager({ dogs }: { dogs: ClientDog[] }) {
  const router = useRouter()
  const [draft, setDraft] = useState<DraftDog | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set the moment a NEW dog is saved. The sheet stays open so the photo
  // uploader (which needs a real dog id) becomes usable without a second trip —
  // this line is what stops that reading as "nothing happened".
  const [added, setAdded] = useState<string | null>(null)

  const editing = draft?.id != null

  function openAdd() {
    setError(null)
    setAdded(null)
    setDraft({ ...EMPTY })
  }

  function openEdit(dog: ClientDog) {
    setError(null)
    setAdded(null)
    setDraft({
      id: dog.id,
      name: dog.name,
      breed: dog.breed ?? '',
      weight: dog.weight?.toString() ?? '',
      dob: dog.dob ?? '',
      photoUrl: dog.photoUrl,
    })
  }

  function close() {
    setDraft(null)
    setError(null)
    setAdded(null)
  }

  function patch(fields: Partial<DraftDog>) {
    setDraft(prev => (prev ? { ...prev, ...fields } : prev))
  }

  async function save() {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) { setError('Give your dog a name.'); return }

    const weight = draft.weight.trim() === '' ? null : Number(draft.weight)
    if (weight != null && (!Number.isFinite(weight) || weight <= 0 || weight > MAX_WEIGHT)) {
      setError(`Weight must be between 0 and ${MAX_WEIGHT} kg.`)
      return
    }
    // Covers "in the future", "before 1970" AND "day and month picked, no year"
    // — the same rules POST /api/my/dogs and PATCH /api/dogs/[dogId] apply, from
    // the same module, so the two ends can't drift.
    const dobProblem = dateOfBirthError(draft.dob)
    if (dobProblem) { setError(dobProblem); return }

    setSaving(true)
    setError(null)
    try {
      const payload = {
        name,
        breed: draft.breed.trim() || null,
        weight,
        dob: draft.dob || null,
      }
      const res = draft.id
        ? await fetch(`/api/dogs/${draft.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/my/dogs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })

      if (!res.ok) {
        setError(draft.id ? 'Could not save your changes.' : 'Could not add your dog.')
        return
      }
      // A brand-new dog now has an id, so the photo uploader becomes usable
      // without leaving the sheet. Editing closes — nothing left to do.
      if (!draft.id) {
        const created = await res.json().catch(() => null)
        if (created?.id) {
          setDraft(prev => (prev ? { ...prev, id: created.id as string } : prev))
          setAdded(`${name} added.`)
          router.refresh()
          return
        }
      }
      close()
      router.refresh()
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!draft?.id) return
    if (!confirm(`Remove ${draft.name || 'this dog'}? Their training history goes too.`)) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/dogs/${draft.id}`, { method: 'DELETE' })
      if (!res.ok) { setError('Could not remove this dog.'); return }
      close()
      router.refresh()
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      {dogs.length === 0 ? (
        <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-8 text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-accent-soft flex items-center justify-center">
            <DogIcon className="h-6 w-6 text-accent" strokeWidth={1.75} />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-700">No dogs added yet</p>
          <p className="mt-1 text-xs text-slate-400">Add your dog so your trainer knows who they&apos;re working with.</p>
          <Button className="mt-4" onClick={openAdd}>Add a dog</Button>
        </div>
      ) : (
        <>
          {dogs.map(d => {
            const age = ageYears(d.dob)
            return (
              <div key={d.id} className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] overflow-hidden flex">
                {d.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.photoUrl} alt={d.name} className="h-28 w-28 object-cover shrink-0" />
                ) : (
                  <div className="h-28 w-28 bg-accent-soft flex items-center justify-center shrink-0"><DogIcon className="h-8 w-8 text-accent" strokeWidth={1.75} /></div>
                )}
                <div className="p-4 flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <p className="font-display text-lg font-bold text-slate-900 leading-tight flex-1 min-w-0">{d.name}</p>
                    <button
                      type="button"
                      onClick={() => openEdit(d)}
                      aria-label={`Edit ${d.name}`}
                      className="-mr-1 -mt-1 shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <Pencil className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </div>
                  {d.breed && <p className="text-xs text-slate-500">{d.breed}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {/* A dog that has died stays on this list — the history is theirs — but
                        is badged, which is also why they no longer appear in classes. */}
                    {d.deceasedAt && <span className="rounded-full bg-slate-200 text-slate-600 text-[11px] font-semibold px-2 py-0.5">Deceased</span>}
                    {age != null && <span className="rounded-full bg-accent-soft text-accent text-[11px] font-semibold px-2 py-0.5">{age} yr{age === 1 ? '' : 's'}</span>}
                    {d.weight != null && <span className="rounded-full bg-accent-soft text-accent text-[11px] font-semibold px-2 py-0.5">{d.weight} kg</span>}
                  </div>
                </div>
              </div>
            )
          })}
          <button
            type="button"
            onClick={openAdd}
            className="w-full rounded-3xl border border-dashed border-slate-300 bg-white/60 py-4 text-sm font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-900 flex items-center justify-center gap-2"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} /> Add another dog
          </button>
        </>
      )}

      {draft && (
        <FullScreenSheet
          title={editing ? `Edit ${draft.name || 'dog'}` : 'Add a dog'}
          sub={editing ? undefined : 'Just a name to start — you can fill in the rest later.'}
          size="lg"
          onClose={close}
          footer={
            <div className="flex gap-2">
              <Button className="flex-1" loading={saving} onClick={save}>
                {editing ? 'Save changes' : draft.id ? 'Done' : 'Add dog'}
              </Button>
              {draft.id && (
                <Button variant="danger" loading={deleting} onClick={remove}>
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  <span className="sr-only">Remove dog</span>
                </Button>
              )}
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            {error && <Alert variant="error">{error}</Alert>}
            {added && !error && <Alert variant="success">{added} Add a photo below, or tap Done.</Alert>}
            <Input
              label="Name"
              required
              maxLength={MAX_NAME}
              autoFocus
              placeholder="Bailey"
              value={draft.name}
              onChange={e => patch({ name: e.target.value })}
            />
            <BreedSelect label="Breed" value={draft.breed} onChange={v => patch({ breed: v })} />
            <Input
              label="Weight (kg)"
              type="number"
              min={0}
              max={MAX_WEIGHT}
              step="0.1"
              inputMode="decimal"
              placeholder="12.5"
              value={draft.weight}
              onChange={e => patch({ weight: e.target.value })}
            />
            {/* Its own row, not half a two-column grid: three selects need the
                full width of a 390px screen. */}
            <DateOfBirthField
              idPrefix="my-dog"
              value={draft.dob}
              onChange={v => patch({ dob: v })}
            />
            {draft.id ? (
              <DogPhotoUpload
                dogId={draft.id}
                dogName={draft.name}
                initialPhotoUrl={draft.photoUrl}
                onChange={url => patch({ photoUrl: url })}
              />
            ) : (
              <p className="text-xs text-slate-400">Add a photo once you&apos;ve saved — we need somewhere to put it.</p>
            )}
          </div>
        </FullScreenSheet>
      )}
    </>
  )
}
