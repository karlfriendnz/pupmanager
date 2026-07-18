'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BreedSelect } from '@/components/shared/breed-select'
import { Alert } from '@/components/ui/alert'
import { Plus, Trash2 } from 'lucide-react'
import { PlaceAutocomplete } from '@/components/maps/place-autocomplete'
import type { ResolvedFieldConfig } from '@/lib/client-fields'

export type CustomField = {
  id: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  required: boolean
  options: string[]
  category: string | null
  appliesTo: 'OWNER' | 'DOG'
}

type DogDraft = { name: string; breed: string; weight: string; dob: string; notes: string }
const blankDog = (): DogDraft => ({ name: '', breed: '', weight: '', dob: '', notes: '' })

function Req({ on }: { on: boolean }) {
  return on ? <span className="text-red-500 ml-1">*</span> : null
}

function CustomFieldInput({ field, value, onChange }: { field: CustomField; value: string; onChange: (v: string) => void }) {
  const cls = 'h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent'
  return (
    <div>
      <label className="text-sm font-medium text-slate-700 block mb-1.5">{field.label}<Req on={field.required} /></label>
      {field.type === 'DROPDOWN' ? (
        <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
          <option value="">Select…</option>
          {field.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : field.type === 'NUMBER' ? (
        <input type="number" value={value} onChange={e => onChange(e.target.value)} className={cls} />
      ) : (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={2} className="w-full min-h-[3rem] rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent" />
      )}
    </div>
  )
}

export function CreateClientForm({
  config, customFields, defaultTemplate,
}: {
  config: ResolvedFieldConfig
  customFields: CustomField[]
  defaultTemplate: string
}) {
  const router = useRouter()
  const ownerFields = customFields.filter(f => f.appliesTo === 'OWNER')
  const dogFields = customFields.filter(f => f.appliesTo === 'DOG')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState<{ line: string; lat: number | null; lng: number | null; placeId: string | null }>({ line: '', lat: null, lng: null, placeId: null })
  const [dogs, setDogs] = useState<DogDraft[]>([blankDog()])
  // keyed `${fieldId}` for OWNER, `${fieldId}:${dogIndex}` for DOG
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [sendInvite, setSendInvite] = useState(true)
  const [emailBody, setEmailBody] = useState(defaultTemplate)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const setCustom = (key: string, v: string) => setCustomValues(prev => ({ ...prev, [key]: v }))
  const updateDog = (i: number, patch: Partial<DogDraft>) => setDogs(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d))

  // Live preview substitution mirrors the old invite form.
  const dogNames = dogs.map(d => d.name.trim()).filter(Boolean)
  const dogNamesFmt = dogNames.length === 0 ? '{{dogName}}'
    : dogNames.length === 1 ? dogNames[0]
    : dogNames.slice(0, -1).join(', ') + ' and ' + dogNames[dogNames.length - 1]
  const previewBody = emailBody.replace(/{{clientName}}/g, name || '{{clientName}}').replace(/{{dogName}}/g, dogNamesFmt)

  async function submit() {
    setBusy(true); setError(null)
    try {
      const customValuesPayload = customFields.flatMap(cf => {
        if (cf.appliesTo === 'OWNER') {
          const v = customValues[cf.id] ?? ''
          return v.trim() ? [{ fieldId: cf.id, value: v, dogIndex: null as number | null }] : []
        }
        return dogs.flatMap((_, i) => {
          const v = customValues[`${cf.id}:${i}`] ?? ''
          return v.trim() ? [{ fieldId: cf.id, value: v, dogIndex: i }] : []
        })
      })
      const res = await fetch('/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'full',
          name, email: email.trim() || undefined, phone,
          address: address.line.trim() ? address : null,
          dogs: dogs.filter(d => d.name.trim()).map(d => ({
            name: d.name, breed: d.breed || undefined,
            weight: d.weight.trim() ? Number(d.weight) : null,
            dob: d.dob || null, notes: d.notes || undefined,
          })),
          customValues: customValuesPayload,
          sendInvite: sendInvite && !!email.trim(),
          emailBody,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not create client.'); return }
      setDone(true)
      setTimeout(() => router.push(body.clientId ? `/clients/${body.clientId}` : '/clients'), 1200)
    } finally { setBusy(false) }
  }

  if (done) {
    return (
      <Alert variant="success">
        <p className="text-lg font-semibold">Client created! 🎉</p>
        <p className="text-sm mt-1">Taking you to your client list…</p>
      </Alert>
    )
  }

  const fieldInput = 'h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent'

  return (
    <form onSubmit={e => { e.preventDefault(); submit() }} className="flex flex-col gap-6">
      {error && <Alert variant="error">{error}</Alert>}

      {/* Contact */}
      <Card><CardBody className="py-5 flex flex-col gap-4">
        <h2 className="font-semibold text-slate-900">Contact</h2>
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Client name<Req on={config.name.required} /></label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Email<Req on={config.email.required} /></label>
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com (optional)" />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Phone<Req on={config.phone.required} /></label>
          <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="021 234 5678" />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Address<Req on={config.address.required} /></label>
          <PlaceAutocomplete
            initialValue={address.line}
            placeholder="Search address…"
            onSelect={(p) => setAddress({ line: p.address, lat: p.lat, lng: p.lng, placeId: p.placeId })}
            // Keep a typed address even if the trainer never taps a Google
            // suggestion (e.g. rural addresses Google doesn't list). Coordinates
            // stay null until geocoded — far better than losing the address.
            onTextChange={(line) => setAddress({ line, lat: null, lng: null, placeId: null })}
          />
        </div>
        {ownerFields.length > 0 && ownerFields.map(f => (
          <CustomFieldInput key={f.id} field={f} value={customValues[f.id] ?? ''} onChange={v => setCustom(f.id, v)} />
        ))}
      </CardBody></Card>

      {/* Dogs */}
      <Card><CardBody className="py-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Dogs</h2>
          <button type="button" onClick={() => setDogs(d => [...d, blankDog()])} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-strong">
            <Plus className="h-4 w-4" /> Add dog
          </button>
        </div>
        {dogs.map((dog, i) => (
          <div key={i} className="rounded-xl border border-slate-100 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Dog {i + 1}</span>
              {dogs.length > 1 && (
                <button type="button" onClick={() => setDogs(d => d.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-600" aria-label="Remove dog"><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Name<Req on={config.dogName.required} /></label>
              <Input value={dog.name} onChange={e => updateDog(i, { name: e.target.value })} placeholder="Buddy" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">Breed<Req on={config.dogBreed.required} /></label>
                <BreedSelect value={dog.breed} onChange={v => updateDog(i, { breed: v })} />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">Weight (kg)<Req on={config.dogWeight.required} /></label>
                <input type="number" step="0.1" value={dog.weight} onChange={e => updateDog(i, { weight: e.target.value })} className={fieldInput} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Date of birth<Req on={config.dogDob.required} /></label>
              <input type="date" value={dog.dob} onChange={e => updateDog(i, { dob: e.target.value })} className={fieldInput} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Notes<Req on={config.dogNotes.required} /></label>
              <textarea value={dog.notes} onChange={e => updateDog(i, { notes: e.target.value })} rows={2} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
            {dogFields.map(f => (
              <CustomFieldInput key={`${f.id}:${i}`} field={f} value={customValues[`${f.id}:${i}`] ?? ''} onChange={v => setCustom(`${f.id}:${i}`, v)} />
            ))}
          </div>
        ))}
      </CardBody></Card>

      {/* Invite */}
      <Card><CardBody className="py-5 flex flex-col gap-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={sendInvite} onChange={e => setSendInvite(e.target.checked)} disabled={!email.trim()} className="h-5 w-5 rounded accent-[var(--accent)]" />
          <span>
            <span className="block text-sm font-medium text-slate-800">Send invitation email</span>
            <span className="block text-xs text-slate-400">{email.trim() ? 'Client gets a login link by email' : 'Add an email above to enable the invite'}</span>
          </span>
        </label>
        {sendInvite && email.trim() && (
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Invitation email</label>
            <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={8} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent" />
            <p className="text-xs text-slate-400 mt-1">Preview: {previewBody.slice(0, 120)}{previewBody.length > 120 ? '…' : ''}</p>
          </div>
        )}
      </CardBody></Card>

      <div className="flex justify-end gap-2 pb-10">
        <Button type="button" variant="ghost" onClick={() => router.push('/clients')} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy}>Create client</Button>
      </div>
    </form>
  )
}
