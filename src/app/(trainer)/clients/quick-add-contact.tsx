'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { UserPlus, X, Loader2 } from 'lucide-react'
import { BreedSelect } from '@/components/shared/breed-select'
import { ModalPortal } from '@/components/shared/modal-portal'
import { QUICK_ADD_KEYS } from '@/lib/client-fields'
import type { ClientFieldKey } from '@/lib/client-fields'

type QuickCustomField = {
  id: string; label: string; type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  options: string[]; required: boolean; inQuickAdd: boolean; appliesTo: 'OWNER' | 'DOG'
}
type FieldConfigResponse = { customFields: QuickCustomField[] }

// Built-in fields that can appear in quick-add, with how to read/write them.
const QUICK_FIELDS: { key: ClientFieldKey; label: string; type: 'text' | 'email' | 'tel' | 'number' | 'date' | 'textarea'; scope: 'OWNER' | 'DOG' }[] = [
  { key: 'name', label: 'Name', type: 'text', scope: 'OWNER' },
  { key: 'phone', label: 'Phone', type: 'tel', scope: 'OWNER' },
  { key: 'email', label: 'Email', type: 'email', scope: 'OWNER' },
  { key: 'address', label: 'Address', type: 'text', scope: 'OWNER' },
  { key: 'dogName', label: "Dog's name", type: 'text', scope: 'DOG' },
  { key: 'dogBreed', label: 'Breed', type: 'text', scope: 'DOG' },
  { key: 'dogWeight', label: 'Weight (kg)', type: 'number', scope: 'DOG' },
  { key: 'dogDob', label: 'Date of birth', type: 'date', scope: 'DOG' },
  { key: 'dogNotes', label: 'Notes', type: 'textarea', scope: 'DOG' },
]

// The trigger button. It lives in the page-header actions, which the responsive
// PageHeader renders TWICE (portaled into the desktop top bar + the mobile
// in-page header). That's fine here — the button carries no modal of its own; it
// just flips the ?new=1 flag, and the single <QuickAddModal /> mounted on the
// page reacts. (Previously the whole modal lived in the actions, so it mounted
// twice and ?new=1 opened both copies — the "two quick adds" bug.)
export function QuickAddButton() {
  const router = useRouter()
  const pathname = usePathname()
  return (
    <Button size="sm" variant="secondary" onClick={() => router.push(`${pathname}?new=1`)}>
      <UserPlus className="h-4 w-4" />
      <span className="hidden sm:inline">Quick add</span>
    </Button>
  )
}

// A fast capture form for someone you meet in person — only the fields the
// trainer marked "quick-add". Creates a real client flagged FOLLOW_UP so it
// surfaces in the list to complete later.
//
// MOUNT ONCE per page (in the page body, NOT inside the header actions). Opens
// whenever ?new=1 is present — set by QuickAddButton, the top bar's "+ → New
// client" menu, or the mobile FAB — so every entry point shares one modal.
export function QuickAddModal() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(searchParams.get('new') === '1')
  const [cfg, setCfg] = useState<FieldConfigResponse | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Optional: email them a login link, and optionally an intake form to fill in
  // before they arrive. OFF by default — quick add exists to capture a walk-in
  // in ten seconds, and anything ticked by default is a decision made for you.
  const [sendInvite, setSendInvite] = useState(false)
  const [formId, setFormId] = useState('')
  const [intakeForms, setIntakeForms] = useState<{ id: string; name: string }[]>([])

  // Open when ?new=1 arrives via client navigation (top bar / FAB / the button),
  // not only on first mount.
  useEffect(() => {
    if (searchParams.get('new') === '1') setOpen(true)
  }, [searchParams])

  useEffect(() => {
    if (open && !cfg) {
      fetch('/api/clients/field-config').then(r => r.json()).then(setCfg).catch(() => setError('Could not load form.'))
      // Same filter the full client form uses: a live form that can serve as an
      // intake. A draft would send someone a form nobody finished writing.
      fetch('/api/forms')
        .then(r => r.json())
        .then((all: { id: string; name: string; usableAsIntake: boolean; isActive: boolean }[]) => {
          setIntakeForms(
            (Array.isArray(all) ? all : [])
              .filter(f => f.usableAsIntake && f.isActive)
              .map(f => ({ id: f.id, name: f.name })),
          )
        })
        .catch(() => { /* the invite still works without a form attached */ })
    }
  }, [open, cfg])

  // An invite needs somewhere to go. Quick add's whole point is that the email
  // is optional, so the choice stays available but inert until there is one.
  const hasEmail = !!values.email?.trim()
  const willInvite = sendInvite && hasEmail

  function close() {
    setOpen(false); setValues({}); setError(null)
    setSendInvite(false); setFormId('')
    // Drop ?new=1 so the form doesn't spring back open on a later remount / nav.
    if (typeof window !== 'undefined' && searchParams.get('new')) {
      const url = new URL(window.location.href)
      url.searchParams.delete('new')
      history.replaceState(null, '', `${url.pathname}${url.search}`)
    }
  }

  // The same three every time. Which built-in details showed here used to be a
  // per-company setting; quick-add exists to capture a walk-in in ten seconds, and
  // the configurable version was the one where a trainer couldn't save someone
  // whose email they didn't have.
  const builtinShown = QUICK_FIELDS.filter(f => QUICK_ADD_KEYS.includes(f.key))
  const customShown = cfg ? cfg.customFields.filter(f => f.inQuickAdd) : []

  async function submit() {
    if (!cfg) return
    setBusy(true); setError(null)
    try {
      const dog = {
        name: values.dogName || undefined,
        breed: values.dogBreed || undefined,
        weight: values.dogWeight?.trim() ? Number(values.dogWeight) : null,
        dob: values.dogDob || null,
        notes: values.dogNotes || undefined,
      }
      const hasDog = Object.values(dog).some(v => v != null && v !== '' && !(typeof v === 'number' && Number.isNaN(v)))
      const res = await fetch('/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'quick',
          name: values.name, phone: values.phone, email: values.email?.trim() || undefined,
          address: values.address?.trim() ? { line: values.address } : null,
          // Only when they asked AND there is somewhere to send it.
          sendInvite: willInvite,
          formId: willInvite && formId ? formId : null,
          dogs: hasDog ? [dog] : [],
          customValues: customShown.map(f => ({ fieldId: f.id, value: values[`cf_${f.id}`] ?? '', dogIndex: f.appliesTo === 'DOG' ? 0 : null })).filter(v => v.value.trim()),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not add contact.'); return }
      close()
      // Go straight to the new client's profile (fall back to a list refresh).
      if (body.clientId) router.push(`/clients/${body.clientId}`)
      else router.refresh()
    } finally { setBusy(false) }
  }

  const inputCls = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent'

  if (!open) return null

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4" onClick={close}>
        <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-xl max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
            <h2 className="font-semibold text-slate-900">Quick add contact</h2>
            <button onClick={close} className="p-1 text-slate-400 hover:text-slate-600" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>

          <div className="p-5 flex flex-col gap-4">
            {!cfg ? (
              <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : (
              <>
                {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
                {builtinShown.map(f => (
                  <div key={f.key}>
                    {/* Only the name. The others were starred while the server
                        would happily save without them — and the whole point of
                        quick-add is jotting down a walk-in whose email you don't
                        have. */}
                    <label htmlFor={f.key} className="text-sm font-medium text-slate-700 block mb-1.5">
                      {f.label}{f.key === 'name' && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {f.key === 'dogBreed'
                      // Breed gets the canonical type-ahead combobox; value
                      // wiring (values.dogBreed → payload dog.breed) is unchanged.
                      ? <BreedSelect id={f.key} value={values[f.key] ?? ''} onChange={val => setValues(v => ({ ...v, [f.key]: val }))} />
                      : f.type === 'textarea'
                      ? <textarea id={f.key} value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} rows={2} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent" />
                      : <input id={f.key} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} className={inputCls} />}
                  </div>
                ))}
                {customShown.map(f => (
                  <div key={f.id}>
                    <label htmlFor={`cf_${f.id}`} className="text-sm font-medium text-slate-700 block mb-1.5">
                      {f.label}{f.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {f.type === 'DROPDOWN'
                      ? <select id={`cf_${f.id}`} value={values[`cf_${f.id}`] ?? ''} onChange={e => setValues(v => ({ ...v, [`cf_${f.id}`]: e.target.value }))} className={inputCls}><option value="">Select…</option>{f.options.map(o => <option key={o} value={o}>{o}</option>)}</select>
                      : <input id={`cf_${f.id}`} type={f.type === 'NUMBER' ? 'number' : 'text'} value={values[`cf_${f.id}`] ?? ''} onChange={e => setValues(v => ({ ...v, [`cf_${f.id}`]: e.target.value }))} className={inputCls} />}
                  </div>
                ))}
                {builtinShown.length === 0 && customShown.length === 0 && (
                  <p className="text-sm text-slate-500">No quick-add fields configured. Set them in Settings → Forms.</p>
                )}
                {/* Optional invite. Sits below the fields, above the footnote,
                    so it reads as "and one more thing if you want it" rather
                    than another field to fill in. */}
                <div className="rounded-xl border border-slate-200 bg-white">
                  <label className="flex items-start gap-3 px-3 py-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sendInvite}
                      onChange={e => setSendInvite(e.target.checked)}
                      disabled={!hasEmail}
                      className="mt-0.5 h-5 w-5 rounded accent-[var(--accent)] disabled:opacity-40"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-700">Email them a login link</span>
                      <span className="block text-xs text-slate-400">
                        {hasEmail
                          ? 'They can set up their diary and fill in anything you ask for.'
                          : 'Add an email above to turn this on.'}
                      </span>
                    </span>
                  </label>

                  {willInvite && intakeForms.length > 0 && (
                    <div className="border-t border-slate-100 px-3 py-3">
                      <label htmlFor="quick-intake-form" className="text-sm font-medium text-slate-700 block mb-1.5">
                        Ask them to fill in
                      </label>
                      <select
                        id="quick-intake-form"
                        value={formId}
                        onChange={e => setFormId(e.target.value)}
                        className={inputCls}
                      >
                        <option value="">Nothing — just the login link</option>
                        {intakeForms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                      <p className="mt-1.5 text-xs text-slate-400">They answer it before they reach their diary.</p>
                    </div>
                  )}
                </div>

                <p className="text-xs text-slate-400">Saved as a follow-up — complete the rest of their details later.</p>
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
            <Button type="button" variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
            <Button type="button" onClick={submit} loading={busy} disabled={!cfg || busy}>Add contact</Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
