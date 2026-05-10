'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, X, Copy, Check, Trash2, Pencil, ExternalLink,
  Globe, ToggleLeft, ToggleRight, Code2, FileText,
  ClipboardList,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FormRow as SessionFormRow } from './session/session-forms-manager'
import { CustomFieldsManager } from '../settings/custom-fields-manager'

// ─── Types ─────────────────────────────────────────────────────────────────

type FieldKey = 'phone' | 'message'

const STANDARD_FIELDS: { key: FieldKey; label: string }[] = [
  { key: 'phone', label: 'Phone number' },
  { key: 'message', label: 'Message / notes' },
]

interface EmbedForm {
  id: string
  title: string
  description: string | null
  fields: { key: string; required: boolean }[]
  customFieldIds: string[]
  thankYouTitle: string | null
  thankYouMessage: string | null
  isActive: boolean
}

export interface CustomField {
  id: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  required: boolean
  appliesTo: 'OWNER' | 'DOG'
}

// Full custom field shape used by the intake editor
export interface IntakeCustomField extends CustomField {
  options: string[]
  category: string | null
  order: number
}

// ─── Copy button ─────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied!' : label}
    </button>
  )
}

// ─── Form builder panel ───────────────────────────────────────────────────────

// Page-style embed form editor. Renders in a dedicated route (/forms/embed/new
// or /forms/embed/[formId]) — the parent page provides the chrome (back link
// + title), this component owns the form fields, save/delete/toggle, and the
// embed code reveal. Save and delete redirect back to /settings?tab=forms.
export function EmbedFormEditor({
  initial,
  customFields,
}: {
  initial?: EmbedForm
  customFields: CustomField[]
}) {
  const router = useRouter()
  // Local URL helpers — only meaningful when initial exists.
  const formUrl = typeof window !== 'undefined' && initial
    ? `${window.location.origin}/form/${initial.id}`
    : initial ? `/form/${initial.id}` : undefined
  const embedSnippet = formUrl
    ? `<iframe src="${formUrl}" width="100%" height="700" style="border:none;border-radius:12px;" title="Registration form"></iframe>`
    : undefined
  // Local state mirror of isActive so the toggle button can update without
  // a full refresh round-trip. Synced to initial.isActive on mount.
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [togglingActive, setTogglingActive] = useState(false)
  const [showEmbed, setShowEmbed] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [thankYouTitle, setThankYouTitle] = useState(initial?.thankYouTitle ?? '')
  const [thankYou, setThankYou] = useState(initial?.thankYouMessage ?? '')
  const [fieldConfig, setFieldConfig] = useState<Record<string, { enabled: boolean; required: boolean }>>(() => {
    const init: Record<string, { enabled: boolean; required: boolean }> = {}
    for (const f of STANDARD_FIELDS) {
      const existing = initial?.fields.find(x => x.key === f.key)
      init[f.key] = { enabled: !!existing, required: existing?.required ?? false }
    }
    return init
  })
  const [enabledCustomIds, setEnabledCustomIds] = useState<Set<string>>(
    new Set(initial?.customFieldIds ?? [])
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleField(key: string, prop: 'enabled' | 'required') {
    setFieldConfig(prev => ({
      ...prev,
      [key]: { ...prev[key], [prop]: !prev[key]?.[prop] },
    }))
  }

  function toggleCustom(id: string) {
    setEnabledCustomIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    if (!title.trim()) { setError('Form title is required.'); return }
    setSaving(true)
    setError(null)

    const fields = STANDARD_FIELDS
      .filter(f => fieldConfig[f.key]?.enabled)
      .map(f => ({ key: f.key, required: fieldConfig[f.key]?.required ?? false }))

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      fields,
      customFieldIds: Array.from(enabledCustomIds),
      thankYouTitle: thankYouTitle.trim() || null,
      thankYouMessage: thankYou.trim() || null,
      // Use the live state, not the snapshot from page-load — otherwise
      // toggling Published then clicking Save reverts the toggle.
      isActive,
    }

    const res = initial
      ? await fetch(`/api/embed-forms/${initial.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch('/api/embed-forms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.detail ?? data.error ?? 'Failed to save form.')
      setSaving(false)
      return
    }
    router.push('/settings?tab=forms')
    router.refresh()
  }

  async function onToggleActive() {
    if (!initial) return
    const res = await fetch(`/api/embed-forms/${initial.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    })
    if (!res.ok) return
  }

  async function onDelete() {
    if (!initial) return
    const res = await fetch(`/api/embed-forms/${initial.id}`, { method: 'DELETE' })
    if (!res.ok) return
    router.push('/settings?tab=forms')
    router.refresh()
  }

  const ownerCustom = customFields.filter(f => f.appliesTo === 'OWNER')
  const dogCustom = customFields.filter(f => f.appliesTo === 'DOG')

  return (
    <div className="flex flex-col gap-4">
      {/* Action bar — publish toggle, preview, embed code, delete. Sits above
          the form so trainers can act without scrolling. Only shown for
          existing forms. */}
      {initial && (
        <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={async () => {
                  setTogglingActive(true)
                  try { await onToggleActive(); setIsActive(v => !v) }
                  finally { setTogglingActive(false) }
                }}
                disabled={togglingActive}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                title={isActive ? 'Unpublish' : 'Publish'}
              >
                {isActive
                  ? <ToggleRight className="h-4 w-4 text-green-500" />
                  : <ToggleLeft className="h-4 w-4 text-slate-400" />}
                <span className={isActive ? 'text-green-700' : 'text-slate-500'}>
                  {isActive ? 'Published' : 'Draft'}
                </span>
              </button>
              {formUrl && (
                <a
                  href={formUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Preview
                </a>
              )}
              {embedSnippet && (
                <button
                  type="button"
                  onClick={() => setShowEmbed(v => !v)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  <Code2 className="h-3.5 w-3.5" />
                  {showEmbed ? 'Hide embed code' : 'Embed code'}
                </button>
              )}
            </div>
          </div>

          {showEmbed && embedSnippet && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Paste this on your site</p>
                <CopyButton text={embedSnippet} label="Copy" />
              </div>
              <pre className="text-xs text-slate-600 font-mono bg-white border border-slate-200 rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all">{embedSnippet}</pre>
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl flex flex-col">
        {/* Body */}
        <div className="px-5 py-5 flex flex-col gap-5">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</p>
          )}

          {/* Basic info */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Form title <span className="text-red-500">*</span></label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Register with us"
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Description (optional)</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                placeholder="A short intro shown at the top of the form"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>

          {/* Standard fields */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Fields</p>
            <p className="text-xs text-slate-400 mb-3">Name and email are always included. Add custom fields below for anything dog-specific (breed, vax status, etc.).</p>
            <div className="flex flex-col gap-2">
              {STANDARD_FIELDS.map(f => (
                <FieldToggleRow
                  key={f.key}
                  label={f.label}
                  enabled={fieldConfig[f.key]?.enabled ?? false}
                  required={fieldConfig[f.key]?.required ?? false}
                  onToggleEnabled={() => toggleField(f.key, 'enabled')}
                  onToggleRequired={() => toggleField(f.key, 'required')}
                />
              ))}
              {ownerCustom.map(cf => (
                <CustomFieldToggleRow
                  key={cf.id}
                  label={cf.label}
                  required={cf.required}
                  enabled={enabledCustomIds.has(cf.id)}
                  onToggle={() => toggleCustom(cf.id)}
                />
              ))}
              {dogCustom.map(cf => (
                <CustomFieldToggleRow
                  key={cf.id}
                  label={`${cf.label} (dog)`}
                  required={cf.required}
                  enabled={enabledCustomIds.has(cf.id)}
                  onToggle={() => toggleCustom(cf.id)}
                />
              ))}
            </div>
          </div>

          {/* Success page copy */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Success page</p>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Heading</label>
              <input
                value={thankYouTitle}
                onChange={e => setThankYouTitle(e.target.value)}
                placeholder="You're registered!"
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Body</label>
              <textarea
                value={thankYou}
                onChange={e => setThankYou(e.target.value)}
                rows={3}
                placeholder="Thanks for registering. Check your email — we've sent you a link to access your training diary."
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Footer — Delete on left (existing forms only), Save on right. */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-100 flex-shrink-0 bg-white">
          {initial && (
            confirmDelete ? (
              <div className="flex items-center gap-1 mr-auto">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setDeleting(true)
                    try { await onDelete() } finally { setDeleting(false) }
                  }}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="mr-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )
          )}
          <Button onClick={save} loading={saving} className={initial ? '' : 'w-full'}>
            {initial ? 'Save changes' : 'Create form'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function FieldToggleRow({
  label,
  enabled,
  required,
  onToggleEnabled,
  onToggleRequired,
}: {
  label: string
  enabled: boolean
  required: boolean
  onToggleEnabled: () => void
  onToggleRequired: () => void
}) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${enabled ? 'border-blue-200 bg-blue-50' : 'border-slate-200'}`}>
      <button onClick={onToggleEnabled} className="flex-shrink-0">
        {enabled
          ? <ToggleRight className="h-5 w-5 text-blue-600" />
          : <ToggleLeft className="h-5 w-5 text-slate-300" />}
      </button>
      <span className={`flex-1 text-sm font-medium ${enabled ? 'text-slate-900' : 'text-slate-400'}`}>
        {label}
      </span>
      {enabled && (
        <button
          onClick={onToggleRequired}
          className={`text-xs px-2 py-0.5 rounded-full border font-medium transition-colors ${
            required
              ? 'border-red-300 bg-red-50 text-red-600'
              : 'border-slate-200 text-slate-400 hover:border-slate-300'
          }`}
        >
          {required ? 'Required' : 'Optional'}
        </button>
      )}
    </div>
  )
}

function CustomFieldToggleRow({
  label,
  required,
  enabled,
  onToggle,
}: {
  label: string
  required: boolean
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${enabled ? 'border-violet-200 bg-violet-50' : 'border-slate-200'}`}>
      <button onClick={onToggle} className="flex-shrink-0">
        {enabled
          ? <ToggleRight className="h-5 w-5 text-violet-600" />
          : <ToggleLeft className="h-5 w-5 text-slate-300" />}
      </button>
      <span className={`flex-1 text-sm font-medium ${enabled ? 'text-slate-900' : 'text-slate-400'}`}>
        {label}
      </span>
      {enabled && (
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
          required
            ? 'border-red-300 bg-red-50 text-red-600'
            : 'border-slate-200 text-slate-400'
        }`}>
          {required ? 'Required' : 'Optional'}
        </span>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type FormType = 'INTAKE' | 'EMBED' | 'SESSION'

const TYPE_BADGE: Record<FormType, { label: string; cls: string; Icon: typeof Globe }> = {
  INTAKE: { label: 'Intake', cls: 'bg-amber-100 text-amber-700', Icon: ClipboardList },
  EMBED: { label: 'Embed', cls: 'bg-blue-100 text-blue-700', Icon: Globe },
  SESSION: { label: 'Session', cls: 'bg-violet-100 text-violet-700', Icon: FileText },
}

export function FormsManager({
  initialForms,
  initialSessionForms,
  intakeCustomFields,
  intakeFormPublished,
}: {
  initialForms: EmbedForm[]
  initialSessionForms: SessionFormRow[]
  intakeCustomFields: IntakeCustomField[]
  intakeFormPublished: boolean
}) {
  const router = useRouter()
  // Forms list is read-only here — actual edits live on dedicated routes.
  const forms = initialForms
  const sessionForms = initialSessionForms
  const [picking, setPicking] = useState(false)

  const intakeFieldCount = intakeCustomFields.length

  return (
    <>
      <div className="flex flex-col items-start gap-3 mb-4">
        <p className="text-sm text-slate-500">
          All your forms in one place. Intake gates new clients, embed forms capture leads, session forms record reports.
        </p>
        <Button size="sm" onClick={() => setPicking(true)}>
          <Plus className="h-4 w-4" />
          New form
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {/* Intake form (singleton). Published state is now an explicit flag
            on TrainerProfile — toggled from inside the intake editor. */}
        <FormRowCard
          type="INTAKE"
          title="Intake form"
          description="The first form a client fills in when accepted. You can also fill it on their behalf from a client's edit page."
          meta={`${intakeFieldCount} field${intakeFieldCount === 1 ? '' : 's'} configured`}
          published={intakeFormPublished}
          onEdit={() => router.push('/forms/intake')}
        />

        {/* Embed forms */}
        {forms.map(form => (
          <div key={form.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-4 p-4">
              <TypeBadgeIcon type="EMBED" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-slate-900 truncate">{form.title}</p>
                  <TypeBadge type="EMBED" />
                  <span className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                    form.isActive ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {form.isActive ? 'Published' : 'Draft'}
                  </span>
                </div>
                {form.description && <p className="text-sm text-slate-400 truncate mt-0.5">{form.description}</p>}
                <p className="text-xs text-slate-400 mt-1">
                  {form.fields.length + form.customFieldIds.length} optional field{form.fields.length + form.customFieldIds.length !== 1 ? 's' : ''} configured
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => router.push(`/forms/embed/${form.id}`)} className="p-2 text-slate-400 hover:text-blue-600 transition-colors" title="Edit form">
                  <Pencil className="h-4 w-4" />{/* Publish, preview, embed code, delete are inside the editor page. */}
                </button>
              </div>
            </div>

          </div>
        ))}

        {/* Session forms */}
        {sessionForms.map(f => (
          <div key={f.id} className="bg-white rounded-2xl border border-slate-200">
            <div className="flex items-center gap-4 p-4">
              <TypeBadgeIcon type="SESSION" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-slate-900 truncate">{f.name}</p>
                  <TypeBadge type="SESSION" />
                  <span className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                    f.isActive ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {f.isActive ? 'Published' : 'Draft'}
                  </span>
                </div>
                {f.description && <p className="text-sm text-slate-400 truncate mt-0.5">{f.description}</p>}
                <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 flex-wrap">
                  <span>{f.questions.length} question{f.questions.length === 1 ? '' : 's'}</span>
                  {f.responses > 0 && <><span>·</span><span className="text-blue-600">{f.responses} filled</span></>}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => router.push(`/forms/session/${f.id}`)} className="p-2 text-slate-400 hover:text-blue-600 transition-colors" title="Edit form">
                  <Pencil className="h-4 w-4" />{/* Delete moved into the editor page. */}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Type picker for "+ New form" */}
      {picking && (
        <TypePicker
          onPick={(type) => {
            setPicking(false)
            if (type === 'EMBED') router.push('/forms/embed/new')
            else if (type === 'SESSION') router.push('/forms/session/new')
          }}
          onClose={() => setPicking(false)}
        />
      )}

      {/* Editor modals replaced by dedicated routes:
          /forms/embed/new + /forms/embed/[formId]
          /forms/session/new + /forms/session/[formId]
          /forms/intake */}
    </>
  )
}

function TypeBadge({ type }: { type: FormType }) {
  const meta = TYPE_BADGE[type]
  return (
    <span className={`flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

function TypeBadgeIcon({ type }: { type: FormType }) {
  const meta = TYPE_BADGE[type]
  const Icon = meta.Icon
  return (
    <div className={`flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0 ${meta.cls}`}>
      <Icon className="h-5 w-5" />
    </div>
  )
}

function FormRowCard({
  type,
  title,
  description,
  meta,
  published,
  onEdit,
}: {
  type: FormType
  title: string
  description: string
  meta: string
  published?: boolean
  onEdit: () => void
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200">
      <div className="flex items-center gap-4 p-4">
        <TypeBadgeIcon type={type} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-slate-900 truncate">{title}</p>
            <TypeBadge type={type} />
            {published !== undefined && (
              <span className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                published ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {published ? 'Published' : 'Draft'}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-0.5">{description}</p>
          <p className="text-xs text-slate-400 mt-1">{meta}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onEdit} className="p-2 text-slate-400 hover:text-blue-600 transition-colors" title="Edit">
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function TypePicker({ onPick, onClose }: { onPick: (t: 'EMBED' | 'SESSION') => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900">New form</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-4">Pick a form type. (Intake is a singleton — edit it from the row above.)</p>
        <div className="grid grid-cols-1 gap-2">
          <button
            onClick={() => onPick('EMBED')}
            className="flex items-start gap-3 text-left rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors p-3"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700 flex-shrink-0"><Globe className="h-4 w-4" /></div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Embed form</p>
              <p className="text-xs text-slate-500 mt-0.5">Public lead-capture form to embed on your website. Submissions land in your enquiries.</p>
            </div>
          </button>
          <button
            onClick={() => onPick('SESSION')}
            className="flex items-start gap-3 text-left rounded-xl border border-slate-200 hover:border-violet-300 hover:bg-violet-50 transition-colors p-3"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 text-violet-700 flex-shrink-0"><FileText className="h-4 w-4" /></div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Session form</p>
              <p className="text-xs text-slate-500 mt-0.5">Template you attach to a training session to capture a structured report.</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}

// Page-style intake form editor. Wraps CustomFieldsManager with the page
// chrome the route page provides (back link / heading). The "Done" button
// just navigates back to the forms list.
export function IntakeFormEditor({
  initialFields,
  initialSectionOrder,
  initialPublished,
  initialSystemFieldSections,
}: {
  initialFields: IntakeCustomField[]
  initialSectionOrder: { name: string; description: string | null }[]
  initialPublished: boolean
  initialSystemFieldSections: Partial<Record<'name' | 'email' | 'phone', string | null>>
}) {
  const router = useRouter()
  const [isPublished, setIsPublished] = useState(initialPublished)
  const [togglingPublished, setTogglingPublished] = useState(false)

  async function togglePublished() {
    setTogglingPublished(true)
    try {
      const res = await fetch('/api/trainer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intakeFormPublished: !isPublished }),
      })
      if (res.ok) {
        setIsPublished(v => !v)
        // The trainer layout's FAB reads server-rendered onboarding state.
        // Without this, the FAB keeps showing "What to do — publish the
        // intake form" even after the toggle flips, because the layout
        // never re-fetches.
        router.refresh()
      }
    } finally {
      setTogglingPublished(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Action bar — publish toggle + preview link. */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={togglePublished}
          disabled={togglingPublished}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
          title={isPublished ? 'Unpublish' : 'Publish'}
        >
          <span className={`h-2 w-2 rounded-full ${isPublished ? 'bg-green-500' : 'bg-amber-400'}`} />
          <span className={isPublished ? 'text-green-700' : 'text-amber-700'}>
            {isPublished ? 'Published' : 'Draft'}
          </span>
        </button>
        <span className="text-xs text-slate-400">Click to {isPublished ? 'unpublish' : 'publish'}</span>
        <a
          href="/forms/intake/preview"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-600 hover:bg-blue-50"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Preview form
        </a>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <p className="text-sm text-slate-500 mb-4">
          Fields here gate new clients on first login and appear on each client&apos;s edit page.
          Group fields into sections to walk clients through one section at a time.
        </p>
        <CustomFieldsManager
          initialFields={initialFields}
          initialSectionOrder={initialSectionOrder}
          initialSystemFieldSections={initialSystemFieldSections}
          showSystemFields
        />
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { router.push('/settings?tab=forms'); router.refresh() }}>
          Done
        </Button>
      </div>
    </div>
  )
}
