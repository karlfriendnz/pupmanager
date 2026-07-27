'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BreedSelect } from '@/components/shared/breed-select'
import { Alert } from '@/components/ui/alert'
import { Plus, Trash2, X } from 'lucide-react'
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

/** Contact · Dogs · Invitation email — one section per tab. */
type Step = 'contact' | 'dogs' | 'invite'

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

// Adding a client is a focused flow, not a page you browse from: it owns the
// whole viewport (`fixed inset-0`, above the shell's z-40 sidebar/top bar/tab
// bar) so the main nav is out of the way until it's finished or cancelled.
// That's the same call the offering wizard makes, done from the page instead of
// from app-shell so no other screen is affected.
//
// Its three sections are TABS, not a wizard: a trainer who only wants a name
// and a phone number shouldn't have to click Next past two screens to save, so
// "Create client" is live from any tab and the strip is free navigation.
export function CreateClientForm({
  config, customFields, defaultTemplate, region,
}: {
  config: ResolvedFieldConfig
  customFields: CustomField[]
  defaultTemplate: string
  // ISO alpha-2 of the trainer's country — localises address suggestions.
  region?: string
}) {
  const router = useRouter()
  const ownerFields = customFields.filter(f => f.appliesTo === 'OWNER')
  const dogFields = customFields.filter(f => f.appliesTo === 'DOG')

  const [step, setStep] = useState<Step>('contact')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState<{ line: string; lat: number | null; lng: number | null; placeId: string | null }>({ line: '', lat: null, lng: null, placeId: null })
  const [dogs, setDogs] = useState<DogDraft[]>([blankDog()])
  // keyed `${fieldId}` for OWNER, `${fieldId}:${dogIndex}` for DOG
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [sendInvite, setSendInvite] = useState(true)
  const [emailBody, setEmailBody] = useState(defaultTemplate)
  // Client forms this trainer has published as intake. Fetched rather than
  // passed in because this component is already a client component several
  // levels down; a trainer with none never sees the picker at all.
  const [intakeForms, setIntakeForms] = useState<{ id: string; name: string; inviteBody: string | null }[]>([])
  const [selectedFormId, setSelectedFormId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Never two scrollbars (AGENTS.md standing rule): this surface scrolls, so
  // the page underneath must not for as long as it's up.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  const setCustom = (key: string, v: string) => setCustomValues(prev => ({ ...prev, [key]: v }))
  const updateDog = (i: number, patch: Partial<DogDraft>) => setDogs(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d))

  // Live preview substitution mirrors the old invite form.
  const dogNames = dogs.map(d => d.name.trim()).filter(Boolean)
  const dogNamesFmt = dogNames.length === 0 ? '{{dogName}}'
    : dogNames.length === 1 ? dogNames[0]
    : dogNames.slice(0, -1).join(', ') + ' and ' + dogNames[dogNames.length - 1]
  useEffect(() => {
    fetch('/api/forms')
      .then(r => (r.ok ? r.json() : []))
      .then((all: { id: string; name: string; usableAsIntake: boolean; isActive: boolean; inviteBody: string | null }[]) => {
        // Drafts stay out of the picker — a half-written form must not be the
        // first thing a brand-new client is asked to fill in.
        setIntakeForms(
          all.filter(f => f.usableAsIntake && f.isActive)
             .map(f => ({ id: f.id, name: f.name, inviteBody: f.inviteBody })),
        )
      })
      .catch(() => {})
  }, [])

  // Picking a form loads the invite copy saved ON that form, so the email the
  // client gets matches the form they're about to be asked to fill in.
  function pickForm(id: string) {
    setSelectedFormId(id)
    const form = intakeForms.find(f => f.id === id)
    setEmailBody(form?.inviteBody?.trim() ? form.inviteBody : defaultTemplate)
  }

  const previewBody = emailBody.replace(/{{clientName}}/g, name || '{{clientName}}').replace(/{{dogName}}/g, dogNamesFmt)

  const namedDogs = dogs.filter(d => d.name.trim())
  const willInvite = sendInvite && !!email.trim()

  // A rejected save names a field ("Dog name is required"). Land the trainer on
  // the tab that owns it rather than on whichever one they happened to be on.
  function stepForError(message: string): Step {
    const m = message.toLowerCase()
    if (dogFields.some(f => m.startsWith(f.label.toLowerCase()))) return 'dogs'
    if (m.startsWith('dog')) return 'dogs'
    return 'contact'
  }

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
          dogs: namedDogs.map(d => ({
            name: d.name, breed: d.breed || undefined,
            weight: d.weight.trim() ? Number(d.weight) : null,
            dob: d.dob || null, notes: d.notes || undefined,
          })),
          customValues: customValuesPayload,
          sendInvite: willInvite,
          emailBody,
          formId: selectedFormId || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = body.error ?? 'Could not create client.'
        setError(message)
        setStep(stepForError(String(message)))
        return
      }
      // Straight to the client. There used to be a 1.2s "Client created! 🎉"
      // pause here before navigating — a second of dead time bolted onto the
      // save, on top of the invite email the API used to send inline.
      setDone(true)
      router.push(body.clientId ? `/clients/${body.clientId}` : '/clients')
    } finally { setBusy(false) }
  }

  const fieldInput = 'h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent'

  const steps: { id: Step; label: string; note?: string }[] = [
    { id: 'contact', label: 'Contact' },
    { id: 'dogs', label: 'Dogs', note: namedDogs.length > 0 ? String(namedDogs.length) : undefined },
    { id: 'invite', label: 'Invitation email', note: willInvite ? 'On' : 'Off' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Title row and a way out — this screen owns the viewport, so it brings
          its own chrome (AGENTS.md: full screens, not dropdowns). */}
      <div
        className="flex items-center gap-3 border-b border-slate-200 px-4 py-3"
        style={{ paddingTop: 'calc(0.75rem + min(env(safe-area-inset-top, 0px), 1rem))' }}
      >
        <button
          type="button"
          onClick={() => router.push('/clients')}
          aria-label="Close"
          className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100"
        >
          <X className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900">New client</h1>
      </div>

      {/* Section tabs. Flat text tabs on one hairline that runs the full width —
          no pill track, nothing tinted. */}
      <div className="flex gap-5 overflow-x-auto border-b border-slate-200 px-4 no-scrollbar">
        {steps.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStep(s.id)}
            aria-current={step === s.id ? 'page' : undefined}
            className={`shrink-0 -mb-px border-b-2 py-2.5 text-sm font-medium transition-colors ${
              step === s.id
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {s.label}
            {s.note && <span className="ml-1.5 text-[11px] font-normal tabular-nums text-slate-400">{s.note}</span>}
          </button>
        ))}
      </div>

      <form
        id="new-client-form"
        onSubmit={e => { e.preventDefault(); submit() }}
        className="min-h-0 flex-1 overflow-y-auto no-scrollbar"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:p-6">
          {error && <Alert variant="error">{error}</Alert>}
          {done && <Alert variant="success">Client created — opening their profile…</Alert>}

          {/* ── Contact ────────────────────────────────────────────────── */}
          <div className={step === 'contact' ? 'flex flex-col gap-4' : 'hidden'}>
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
                region={region}
                onSelect={(p) => setAddress({ line: p.address, lat: p.lat, lng: p.lng, placeId: p.placeId })}
                // Keep a typed address even if the trainer never taps a Google
                // suggestion (e.g. rural addresses Google doesn't list). Coordinates
                // stay null until geocoded — far better than losing the address.
                onTextChange={(line) => setAddress({ line, lat: null, lng: null, placeId: null })}
              />
            </div>
            {ownerFields.map(f => (
              <CustomFieldInput key={f.id} field={f} value={customValues[f.id] ?? ''} onChange={v => setCustom(f.id, v)} />
            ))}
          </div>

          {/* ── Dogs ───────────────────────────────────────────────────── */}
          <div className={step === 'dogs' ? 'flex flex-col gap-4' : 'hidden'}>
            {dogs.map((dog, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Dog {i + 1}</span>
                  {dogs.length > 1 && (
                    <button type="button" onClick={() => setDogs(d => d.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-600" aria-label="Remove dog"><Trash2 className="h-4 w-4" strokeWidth={1.75} /></button>
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
            <button
              type="button"
              onClick={() => setDogs(d => [...d, blankDog()])}
              className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-accent hover:text-accent-strong"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} /> Add dog
            </button>
          </div>

          {/* ── Invitation email ───────────────────────────────────────── */}
          <div className={step === 'invite' ? 'flex flex-col gap-4' : 'hidden'}>
            {intakeForms.length > 0 && (
              <div>
                <label htmlFor="intake-form" className="text-sm font-medium text-slate-700 block mb-1.5">Ask them to fill in</label>
                <select
                  id="intake-form"
                  value={selectedFormId}
                  onChange={e => pickForm(e.target.value)}
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">Just your usual fields</option>
                  {intakeForms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  They answer this before they reach their home screen. Picking one loads its invitation email below.
                </p>
              </div>
            )}
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={sendInvite} onChange={e => setSendInvite(e.target.checked)} disabled={!email.trim()} className="h-5 w-5 rounded accent-[var(--accent)]" />
              <span>
                <span className="block text-sm font-medium text-slate-800">Send invitation email</span>
                <span className="block text-xs text-slate-400">{email.trim() ? 'Client gets a login link by email' : 'Add an email on Contact to enable the invite'}</span>
              </span>
            </label>
            {willInvite && (
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">Invitation email</label>
                <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={10} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent" />
                <p className="text-xs text-slate-400 mt-1">Preview: {previewBody.slice(0, 120)}{previewBody.length > 120 ? '…' : ''}</p>
              </div>
            )}
          </div>
        </div>
      </form>

      {/* Pinned action bar — reachable from any tab, so a trainer who only
          wanted a name and a phone number saves without touring the others. */}
      <div
        className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <Button type="button" variant="ghost" onClick={() => router.push('/clients')} disabled={busy}>Cancel</Button>
        <Button type="submit" form="new-client-form" loading={busy}>Create client</Button>
      </div>
    </div>
  )
}
