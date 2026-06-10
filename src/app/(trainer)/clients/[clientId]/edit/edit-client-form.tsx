'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { DogPhotoUpload } from '@/components/shared/dog-photo-upload'
import { PlaceAutocomplete } from '@/components/maps/place-autocomplete'

type Tab = 'dogs' | 'details'

type CustomField = {
  id: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  required: boolean
  options: string[]
  category: string | null
  appliesTo: 'OWNER' | 'DOG'
}

type Dog = {
  id: string | null
  name: string
  breed: string
  weight: string
  dob: string
  notes: string
  photoUrl: string | null
  isPrimary: boolean
  isNew?: boolean
}

type Props = {
  clientId: string
  initialName: string
  initialEmail: string
  initialPhone: string
  initialAddress: string | null
  /** Trainer's base — biases the address autocomplete toward their city. */
  biasLat: number | null
  biasLng: number | null
  /** False for co-managers — field renders read-only with a hint. */
  canEditEmail: boolean
  initialDogs: Dog[]
  customFields: CustomField[]
  initialFieldValues: Record<string, string>
}

function groupByCategory(fields: CustomField[]) {
  const groups: { category: string | null; fields: CustomField[] }[] = []
  const seen = new Set<string | null>()
  for (const f of fields) {
    const key = f.category ?? null
    if (!seen.has(key)) {
      seen.add(key)
      groups.push({ category: key, fields: fields.filter(x => (x.category ?? null) === key) })
    }
  }
  return groups
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: CustomField
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-700 block mb-1.5">
        {field.label}{field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {field.type === 'DROPDOWN' ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select...</option>
          {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : field.type === 'NUMBER' ? (
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      ) : (
        // Free-text answers are usually sentences/paragraphs — a multi-line,
        // resizable box rather than a cramped single line.
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={2}
          className="w-full min-h-[3rem] rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}
    </div>
  )
}

export function EditClientForm({ clientId, initialName, initialEmail, initialPhone, initialAddress, biasLat, biasLng, canEditEmail, initialDogs, customFields, initialFieldValues }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Open straight to Details when linked with ?tab=details (e.g. route manager).
  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'details' ? 'details' : 'dogs')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [phone, setPhone] = useState(initialPhone)
  const [address, setAddress] = useState(initialAddress ?? '')
  const [dogs, setDogs] = useState<Dog[]>(initialDogs)
  const [expandedDog, setExpandedDog] = useState<number>(0)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(initialFieldValues)

  const ownerFields = customFields.filter(f => f.appliesTo === 'OWNER')
  const dogFields   = customFields.filter(f => f.appliesTo === 'DOG')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'dogs',    label: dogs.length > 1 ? `Dogs (${dogs.length})` : 'Dog' },
    { id: 'details', label: 'Details' },
  ]

  function setFieldValue(key: string, value: string) {
    setFieldValues(prev => ({ ...prev, [key]: value }))
  }

  function addDog() {
    const newDog: Dog = { id: null, name: '', breed: '', weight: '', dob: '', notes: '', photoUrl: null, isPrimary: false, isNew: true }
    setDogs(prev => [...prev, newDog])
    setExpandedDog(dogs.length)
  }

  function updateDog(index: number, field: keyof Dog, value: string) {
    setDogs(prev => prev.map((d, i) => i === index ? { ...d, [field]: value } : d))
  }

  async function removeDog(index: number) {
    const dog = dogs[index]
    if (dog.id && !dog.isNew) {
      if (!confirm(`Remove ${dog.name}? This cannot be undone.`)) return
      await fetch(`/api/clients/${clientId}/dogs/${dog.id}`, { method: 'DELETE' })
    }
    setDogs(prev => prev.filter((_, i) => i !== index))
    setExpandedDog(Math.max(0, expandedDog - 1))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)

    const trimmedEmail = email.trim()
    // Skip the email field on the wire when it's unchanged so a
    // canEditEmail=false trainer (co-manager) doesn't bounce off the
    // server-side primary-trainer check just because the form
    // resubmitted the existing value.
    const emailChanged = canEditEmail && trimmedEmail !== '' && trimmedEmail.toLowerCase() !== initialEmail.trim().toLowerCase()

    const primaryDog = dogs.find(d => d.isPrimary)
    const res = await fetch(`/api/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        phone: phone.trim() || null,
        ...(emailChanged ? { email: trimmedEmail } : {}),
        dog: primaryDog ? {
          name: primaryDog.name,
          breed: primaryDog.breed || null,
          weight: primaryDog.weight ? parseFloat(primaryDog.weight) : null,
          dob: primaryDog.dob || null,
          notes: primaryDog.notes || null,
        } : undefined,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(typeof data.error === 'string' ? data.error : 'Failed to save. Please try again.')
      setSaving(false)
      return
    }

    for (const dog of dogs.filter(d => !d.isPrimary)) {
      if (!dog.name.trim()) continue
      if (dog.isNew || !dog.id) {
        await fetch(`/api/clients/${clientId}/dogs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: dog.name, breed: dog.breed || null,
            weight: dog.weight ? parseFloat(dog.weight) : null,
            dob: dog.dob || null, notes: dog.notes || null,
          }),
        })
      } else {
        await fetch(`/api/clients/${clientId}/dogs/${dog.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: dog.name, breed: dog.breed || null,
            weight: dog.weight ? parseFloat(dog.weight) : null,
            dob: dog.dob || null, notes: dog.notes || null,
          }),
        })
      }
    }

    if (customFields.length > 0) {
      const values = Object.entries(fieldValues)
        .filter(([, v]) => v !== '')
        .map(([key, value]) => {
          const [fieldId, dogId] = key.split(':')
          return { fieldId, value, dogId: dogId ?? null }
        })
      if (values.length > 0) {
        await fetch(`/api/clients/${clientId}/field-values`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values }),
        })
      }
    }

    router.push(`/clients/${clientId}`)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</p>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
              tab === t.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Dogs ─────────────────────────────────────────────────────────── */}
      {tab === 'dogs' && (
        <div className={`grid gap-5 ${dogs.length > 1 ? 'md:grid-cols-2' : ''}`}>
          {dogs.map((dog, i) => (
            <Card key={i} className="overflow-hidden">
              {/* Dog header */}
              <button
                type="button"
                onClick={() => setExpandedDog(expandedDog === i ? -1 : i)}
                className="w-full flex items-center justify-between px-5 py-4 bg-gradient-to-br from-slate-50 to-slate-100 border-b border-slate-100 hover:from-slate-100 hover:to-slate-150 transition-colors"
              >
                <div className="text-left">
                  <p className="font-bold text-slate-900">{dog.name || 'New dog'}</p>
                  {dog.breed && <p className="text-xs text-slate-500 mt-0.5">{dog.breed}</p>}
                  {dog.isPrimary && <p className="text-xs text-slate-400 mt-0.5">Primary dog</p>}
                </div>
                <div className="flex items-center gap-2">
                  {!dog.isPrimary && (
                    <span
                      role="button"
                      onClick={e => { e.stopPropagation(); removeDog(i) }}
                      className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-white/60 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                  )}
                  {expandedDog === i
                    ? <ChevronUp className="h-4 w-4 text-slate-400" />
                    : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </div>
              </button>

              {expandedDog === i && (
                <CardBody className="pt-5 flex flex-col gap-4">
                  <Input
                    label="Dog's name"
                    value={dog.name}
                    onChange={e => updateDog(i, 'name', e.target.value)}
                    placeholder="e.g. Buddy"
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Breed" value={dog.breed} onChange={e => updateDog(i, 'breed', e.target.value)} />
                    <Input label="Weight (kg)" type="number" value={dog.weight} onChange={e => updateDog(i, 'weight', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700 block mb-1.5">Date of birth</label>
                    <input
                      type="date"
                      value={dog.dob}
                      onChange={e => updateDog(i, 'dob', e.target.value)}
                      className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700 block mb-1.5">Notes</label>
                    <textarea
                      value={dog.notes}
                      onChange={e => updateDog(i, 'notes', e.target.value)}
                      rows={3}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>

                  <DogPhotoUpload
                    dogId={dog.id}
                    dogName={dog.name}
                    initialPhotoUrl={dog.photoUrl}
                    onChange={(url) => setDogs(prev => prev.map((d, idx) => idx === i ? { ...d, photoUrl: url } : d))}
                  />

                  {/* Dog-specific custom fields */}
                  {dog.id && dogFields.length > 0 && (
                    <div className="border-t border-slate-100 pt-4 flex flex-col gap-5">
                      {groupByCategory(dogFields).map(group => (
                        <div key={group.category ?? '__'}>
                          {group.category && (
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 pb-1 border-b border-slate-100">
                              {group.category}
                            </p>
                          )}
                          <div className="grid grid-cols-1 gap-4">
                            {group.fields.map(field => {
                              const key = `${field.id}:${dog.id}`
                              return (
                                <FieldInput
                                  key={field.id}
                                  field={field}
                                  value={fieldValues[key] ?? ''}
                                  onChange={v => setFieldValue(key, v)}
                                />
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              )}
            </Card>
          ))}

          {/* Add dog button — sits below the grid */}
          <button
            type="button"
            onClick={addDog}
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 mt-1"
          >
            <Plus className="h-4 w-4" /> Add another dog
          </button>
        </div>
      )}

      {/* ── Details ──────────────────────────────────────────────────────── */}
      {tab === 'details' && (
        <div className="flex flex-col gap-6">
          {/* Always-on Name + Email card — the two core identity fields
              live here regardless of whether any custom fields exist.
              Email is gated on canEditEmail (false for co-managers,
              who'd otherwise be able to lock the primary trainer out
              by changing the login credential). */}
          <Card>
            <CardBody className="pt-5 flex flex-col gap-4">
              <h2 className="font-semibold text-slate-900">Client details</h2>
              <Input
                label="Name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Sarah Carter"
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={!canEditEmail}
                  autoComplete="email"
                  placeholder="client@example.com"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
                />
                {canEditEmail ? (
                  <p className="text-xs text-slate-500">
                    Used to log in. Changing this resets their email verification — re-send the invite afterwards.
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Only the primary trainer can change a client&apos;s login email.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  autoComplete="tel"
                  placeholder="+64 21 555 0100"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">Address</label>
                <PlaceAutocomplete
                  initialValue={address}
                  placeholder="Search address…"
                  bias={biasLat != null && biasLng != null ? { lat: biasLat, lng: biasLng } : null}
                  onSelect={async r => {
                    setAddress(r.address)
                    await fetch(`/api/clients/${clientId}/location`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(r),
                    })
                  }}
                />
                <p className="text-[11px] text-slate-400">Used by the route planner to map and optimise visits.</p>
              </div>
            </CardBody>
          </Card>

          {ownerFields.length > 0 && groupByCategory(ownerFields).map(group => (
            <Card key={group.category ?? '__uncategorised__'}>
              <CardBody className="pt-5 flex flex-col gap-1">
                <h2 className="font-semibold text-slate-900 mb-4">{group.category ?? 'Additional details'}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                  {group.fields.map(field => (
                    <FieldInput
                      key={field.id}
                      field={field}
                      value={fieldValues[field.id] ?? ''}
                      onChange={v => setFieldValue(field.id, v)}
                    />
                  ))}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Persistent save bar */}
      <div className="flex gap-3 pt-2 border-t border-slate-100 sticky bottom-4">
        <Button onClick={handleSave} loading={saving}>Save changes</Button>
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </div>
  )
}
