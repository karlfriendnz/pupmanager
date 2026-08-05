'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import {
  Plus, Copy, Check, ExternalLink, Sparkles,
  Globe, Code2, FileText, ChevronRight, List, Trash2,
  ClipboardList, ListChecks,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'
import { isRichTextEmpty, richTextToPlain } from '@/lib/rich-text'
import type { FormRow as SessionFormRow } from './session/session-forms-manager'
import {
  FORM_INPUT, FORM_QUIET_ACTION, FORM_TEXTAREA,
  FormEditorSection, FormEditorShell, FormField, FormRowGroup, FormSegmented, FormToggleRow,
} from './_form-editor-shell'

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
  showBorder: boolean
  buttonColor: string | null
  welcomeSubject: string | null
  welcomeIntro: string | null
  welcomeShowDiaryButton: boolean
  welcomeButtonLabel: string | null
  autoReplyMode: 'OFF' | 'TEMPLATE' | 'CUSTOM'
  autoReplyTemplateId: string | null
  autoReplySubject: string | null
  autoReplyBody: string | null
}

// A saved email template the trainer can pick as a form's auto-reply.
export interface EmailTemplateOption {
  id: string
  name: string
  category: string | null
}

const DEFAULT_BUTTON_COLOR = '#2563eb' // Tailwind blue-600 — platform default

// Placeholder copy mirroring the platform defaults in src/lib/enquiries.ts
// (DEFAULT_WELCOME_*). Kept as literals here because that module is
// server-only (pulls in prisma/crypto) and can't be imported into this
// client component. {business} / {name} are substituted at send time.
const WELCOME_SUBJECT_PLACEHOLDER = 'Welcome to {business} — finish setting up your account'
const WELCOME_INTRO_PLACEHOLDER =
  'Thanks for registering with {business}. Click the button below to access your training diary — no password needed, the link logs you in automatically.'
const WELCOME_BUTTON_PLACEHOLDER = 'Access my training diary'

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
    <button onClick={copy} className={FORM_QUIET_ACTION}>
      {copied
        ? <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
        : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
      {copied ? 'Copied!' : label}
    </button>
  )
}

// ─── Lead-capture form editor ────────────────────────────────────────────────

/** One field that is ON this form, in the right-hand pane. */
function EmbedFieldRow({
  label,
  note,
  required,
  onToggleRequired,
  onRemove,
}: {
  label: string
  note?: string
  required: boolean
  /** Absent when requiredness belongs to the field itself, not to this form. */
  onToggleRequired?: () => void
  /** Absent for name/email — a registration without either is not a lead. */
  onRemove?: () => void
}) {
  return (
    <div className="flex items-center gap-3 bg-white px-3 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{label}</span>
        {note && <span className="mt-0.5 block truncate text-xs text-slate-400">{note}</span>}
      </span>
      {onToggleRequired ? (
        <button
          type="button"
          onClick={onToggleRequired}
          className="flex-shrink-0 text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
        >
          {required ? 'Required' : 'Optional'}
        </button>
      ) : (
        <span className="flex-shrink-0 text-xs text-slate-400">{required ? 'Required' : 'Optional'}</span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="flex-shrink-0 p-1 text-slate-300 hover:text-red-500"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
    </div>
  )
}

/** A row on the lead-capture rail — click to put that field on the form. */
function EmbedPaletteRow({ label, note, onClick }: { label: string; note?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Add ${label}`}
      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50 active:bg-slate-50"
    >
      <Plus className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{label}</span>
        {note && <span className="mt-0.5 block truncate text-xs text-slate-400">{note}</span>}
      </span>
    </button>
  )
}

// Page-style lead-capture (embed) form editor. Renders in a dedicated route
// (/forms/embed/new or /forms/embed/[formId]) — the parent page provides the
// chrome (back link + title), FormEditorShell provides the frame every form
// editor shares, and this component owns the sections. Save and delete redirect
// back to Settings → Fields & forms.
//
// It wears the SAME shape as the FormBuilder the other two editors run — fields
// on the left, the form on the right, a Settings panel for what happens after
// submit — because Karl's complaint was that opening one form and opening
// another gave you two different screens.
//
// It does NOT run the FormBuilder itself, and can't: an EmbedForm has no
// questions. Its shape is `fields: [{key, required}]` plus `customFieldIds: []`
// — two fixed toggles and a set of links, with no question types, no answer
// types, no conditional logic and no single ordered list. Giving it a real
// palette-drop would mean converting these rows into the Form model, which is a
// DATA migration, not a UI one. Nothing creates an EmbedForm any more (a client
// form set to "Website enquiry" replaced it); this screen exists so the ones
// already embedded on trainers' sites stay maintainable. Hence: same layout,
// click to add rather than drag.
export function EmbedFormEditor({
  initial,
  customFields,
  emailTemplates = [],
}: {
  initial?: EmbedForm
  customFields: CustomField[]
  emailTemplates?: EmailTemplateOption[]
}) {
  const router = useRouter()
  // Local URL helpers — only meaningful when initial exists. Computed
  // in an effect (not during render) so SSR and the first client
  // render produce the same HTML; reading `window.location.origin`
  // inline would emit different markup and trigger a hydration
  // mismatch warning that breaks event-handler attachment (which is
  // why the save button + colour picker stopped responding).
  const [formUrl, setFormUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!initial) return
    setFormUrl(`${window.location.origin}/form/${initial.id}`)
  }, [initial])
  const embedSnippet = formUrl
    ? `<iframe src="${formUrl}" width="100%" height="700" style="border:none;border-radius:12px;" title="Registration form"></iframe>`
    : undefined
  // Local state mirror of isActive so the toggle button can update without
  // a full refresh round-trip. Synced to initial.isActive on mount.
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [togglingActive, setTogglingActive] = useState(false)
  const [showEmbed, setShowEmbed] = useState(false)
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
  const [showBorder, setShowBorder] = useState(initial?.showBorder ?? true)
  const [buttonColor, setButtonColor] = useState(initial?.buttonColor ?? DEFAULT_BUTTON_COLOR)
  const [welcomeSubject, setWelcomeSubject] = useState(initial?.welcomeSubject ?? '')
  const [welcomeIntro, setWelcomeIntro] = useState(initial?.welcomeIntro ?? '')
  const [welcomeShowDiaryButton, setWelcomeShowDiaryButton] = useState(initial?.welcomeShowDiaryButton ?? true)
  const [welcomeButtonLabel, setWelcomeButtonLabel] = useState(initial?.welcomeButtonLabel ?? '')
  const [autoReplyMode, setAutoReplyMode] = useState<'OFF' | 'TEMPLATE' | 'CUSTOM'>(initial?.autoReplyMode ?? 'OFF')
  const [autoReplyTemplateId, setAutoReplyTemplateId] = useState(initial?.autoReplyTemplateId ?? '')
  const [autoReplySubject, setAutoReplySubject] = useState(initial?.autoReplySubject ?? '')
  const [autoReplyBody, setAutoReplyBody] = useState(initial?.autoReplyBody ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Same two panels as the shared builder: what the form IS, and what happens
  // once someone has filled it in.
  const [tab, setTab] = useState<'build' | 'settings'>('build')
  // Phones get no rail (see FormEditorShell.sidebar) — the same list opens as a
  // full screen instead.
  const [paletteSheetOpen, setPaletteSheetOpen] = useState(false)

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
      showBorder,
      // Store null when the trainer hasn't touched the colour (matches
      // platform blue) so resetting back to default is a real toggle.
      buttonColor: buttonColor.toLowerCase() === DEFAULT_BUTTON_COLOR ? null : buttonColor,
      // Welcome email — blank → null so the send falls back to the
      // platform default copy.
      welcomeSubject: welcomeSubject.trim() || null,
      welcomeIntro: welcomeIntro.trim() || null,
      welcomeShowDiaryButton,
      welcomeButtonLabel: welcomeButtonLabel.trim() || null,
      autoReplyMode,
      autoReplyTemplateId: autoReplyMode === 'TEMPLATE' ? (autoReplyTemplateId || null) : null,
      autoReplySubject: autoReplyMode === 'CUSTOM' ? (autoReplySubject.trim() || null) : null,
      autoReplyBody: autoReplyMode === 'CUSTOM' ? (autoReplyBody.trim() || null) : null,
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
    setTogglingActive(true)
    try {
      const res = await fetch(`/api/embed-forms/${initial.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      })
      if (res.ok) setIsActive(v => !v)
    } finally {
      setTogglingActive(false)
    }
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
  const orderedCustom = [...ownerCustom, ...dogCustom]

  const customLabel = (cf: CustomField) => (cf.appliesTo === 'DOG' ? `${cf.label} (dog)` : cf.label)
  const offStandard = STANDARD_FIELDS.filter(f => !fieldConfig[f.key]?.enabled)
  const offCustom = orderedCustom.filter(cf => !enabledCustomIds.has(cf.id))

  function addField(add: () => void) {
    add()
    setPaletteSheetOpen(false)
  }

  const palette = (
    <div className="flex flex-col gap-4">
      <div>
        <SectionLabel>Add a field</SectionLabel>
        <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-100">
          {offStandard.length === 0 && offCustom.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-400">
              Everything you have is already on this form.
            </p>
          ) : (
            <>
              {offStandard.map(f => (
                <EmbedPaletteRow
                  key={f.key}
                  label={f.label}
                  onClick={() => addField(() => toggleField(f.key, 'enabled'))}
                />
              ))}
              {offCustom.map(cf => (
                <EmbedPaletteRow
                  key={cf.id}
                  label={customLabel(cf)}
                  note={cf.type.toLowerCase()}
                  onClick={() => addField(() => toggleCustom(cf.id))}
                />
              ))}
            </>
          )}
        </div>
      </div>
      <p className="px-1 text-xs text-slate-400">
        Name and email are on every lead-capture form — an enquiry with neither is
        nobody you can reply to.
      </p>
    </div>
  )

  return (
    <>
    {/* Which panel a review pin was made on (AGENTS.md). */}
    <div data-review-scope={`Lead-capture form: ${tab === 'build' ? 'Build' : 'Settings'}`}>
    <div className="mb-3 px-1">
      <FormSegmented
        ariaLabel="Form builder panel"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'build' as const, label: 'Build' },
          { id: 'settings' as const, label: 'Settings' },
        ]}
      />
    </div>
    <FormEditorShell
      sidebar={tab === 'build' ? palette : undefined}
      status={initial ? { isActive, busy: togglingActive, onToggle: onToggleActive } : undefined}
      statusActions={initial ? (
        <>
          {formUrl && (
            <a href={formUrl} target="_blank" rel="noopener noreferrer" className={FORM_QUIET_ACTION}>
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              Preview
            </a>
          )}
          {embedSnippet && (
            <button type="button" onClick={() => setShowEmbed(v => !v)} className={FORM_QUIET_ACTION}>
              <Code2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              {showEmbed ? 'Hide embed code' : 'Embed code'}
            </button>
          )}
        </>
      ) : undefined}
      error={error}
      onDelete={initial ? onDelete : undefined}
      onCancel={() => router.push('/settings?tab=forms')}
      onSave={save}
      saving={saving}
      saveLabel={initial ? 'Save changes' : 'Create form'}
    >
      {tab === 'build' && <>
      {showEmbed && embedSnippet && (
        <FormEditorSection title="Paste this on your site" action={<CopyButton text={embedSnippet} label="Copy" />}>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
            {embedSnippet}
          </pre>
        </FormEditorSection>
      )}

      <FormEditorSection title="Basics">
        <FormField label="Form title" required>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Register with us"
            aria-label="Form title"
            className={FORM_INPUT}
          />
        </FormField>
        <FormField label="Description" hint="Optional — shown above the fields on the public form.">
          <RichTextEditor
            value={description}
            onChange={html => setDescription(isRichTextEmpty(html) ? '' : html)}
            minHeight={120}
            theme="light"
          />
        </FormField>
      </FormEditorSection>

      {/* What is ON the form, in the order the public page renders it. Adding
          happens on the rail (or the sheet on a phone), so this list is the
          FORM rather than a switchboard of everything that could be on it. */}
      <FormEditorSection
        title="Fields"
        hint="In the order someone filling it in will meet them."
        action={
          <button
            type="button"
            onClick={() => setPaletteSheetOpen(true)}
            className={`${FORM_QUIET_ACTION} lg:hidden`}
          >
            <List className="h-3.5 w-3.5" strokeWidth={1.75} />
            Add a field
          </button>
        }
      >
        <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 [&>*+*]:border-t [&>*+*]:border-slate-200">
          <EmbedFieldRow label="Name" note="Always asked" required />
          <EmbedFieldRow label="Email" note="Always asked" required />
          {STANDARD_FIELDS.filter(f => fieldConfig[f.key]?.enabled).map(f => (
            <EmbedFieldRow
              key={f.key}
              label={f.label}
              required={fieldConfig[f.key]?.required ?? false}
              onToggleRequired={() => toggleField(f.key, 'required')}
              onRemove={() => toggleField(f.key, 'enabled')}
            />
          ))}
          {orderedCustom.filter(cf => enabledCustomIds.has(cf.id)).map(cf => (
            <EmbedFieldRow
              key={cf.id}
              label={customLabel(cf)}
              note="One of your saved fields"
              required={cf.required}
              onRemove={() => toggleCustom(cf.id)}
            />
          ))}
        </div>
      </FormEditorSection>
      </>}

      {tab === 'settings' && <>
      {/* Styling — let the trainer match the form to their site's brand. The
          border toggle is useful for embeds where the parent page already
          provides framing; button colour overrides the platform blue. */}
      <FormEditorSection title="Styling">
        <FormRowGroup>
          <FormToggleRow
            label="Card border"
            hint="A subtle border around each field group. Turn it off when you're embedding inside a card of your own."
            checked={showBorder}
            onChange={setShowBorder}
          />
          <div className="flex items-center gap-3 py-3">
            <input
              type="color"
              value={buttonColor}
              onChange={e => setButtonColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white"
              aria-label="Submit button colour"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">Submit button colour</p>
              <p className="break-all text-xs text-slate-400">
                {buttonColor}{buttonColor.toLowerCase() === DEFAULT_BUTTON_COLOR ? ' (platform default)' : ''}
              </p>
            </div>
            {buttonColor.toLowerCase() !== DEFAULT_BUTTON_COLOR && (
              <button
                type="button"
                onClick={() => setButtonColor(DEFAULT_BUTTON_COLOR)}
                className="flex-shrink-0 text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
              >
                Reset
              </button>
            )}
          </div>
        </FormRowGroup>
      </FormEditorSection>

      <FormEditorSection title="Success page" hint="What they see once they've hit submit.">
        <FormField label="Heading">
          <input
            value={thankYouTitle}
            onChange={e => setThankYouTitle(e.target.value)}
            placeholder="You're registered!"
            aria-label="Success page heading"
            className={FORM_INPUT}
          />
        </FormField>
        <FormField label="Body">
          <textarea
            value={thankYou}
            onChange={e => setThankYou(e.target.value)}
            rows={3}
            placeholder="Thanks for registering. Check your email — we've sent you a link to access your training diary."
            aria-label="Success page body"
            className={`${FORM_TEXTAREA} resize-none`}
          />
        </FormField>
      </FormEditorSection>

      {/* Auto-reply — goes to the PERSON WHO FILLED IN THE FORM, the moment
          they submit. Sits above the welcome email because it fires first in
          the timeline (submit → auto-reply, later: accept → welcome). Off by
          default so existing forms don't suddenly start emailing. */}
      <FormEditorSection
        title="Auto-reply email"
        hint={
          <>
            Sent straight away to whoever fills in this form, so they aren&apos;t left wondering.
            Use <code className="text-slate-500">{'{business}'}</code> and <code className="text-slate-500">{'{name}'}</code> to personalise.
          </>
        }
      >
        <FormSegmented
          ariaLabel="Auto-reply"
          value={autoReplyMode}
          onChange={setAutoReplyMode}
          options={[
            { id: 'OFF', label: "Don't send" },
            { id: 'TEMPLATE', label: 'Use a template' },
            { id: 'CUSTOM', label: 'Write my own' },
          ]}
        />

        {autoReplyMode === 'TEMPLATE' && (
          emailTemplates.length === 0 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
              You haven&apos;t saved any email templates yet — add one under Settings → Email
              templates, or choose &ldquo;Write my own&rdquo; instead.
            </p>
          ) : (
            <FormField
              label="Template"
              hint={!autoReplyTemplateId ? 'Nothing sends until you pick one.' : undefined}
            >
              <select
                value={autoReplyTemplateId}
                onChange={e => setAutoReplyTemplateId(e.target.value)}
                aria-label="Auto-reply template"
                className={FORM_INPUT}
              >
                <option value="">Choose a template…</option>
                {emailTemplates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.category ? `${t.category} · ${t.name}` : t.name}
                  </option>
                ))}
              </select>
            </FormField>
          )
        )}

        {autoReplyMode === 'CUSTOM' && (
          <>
            <FormField label="Subject">
              <input
                value={autoReplySubject}
                onChange={e => setAutoReplySubject(e.target.value)}
                placeholder="Thanks for getting in touch with {business}"
                aria-label="Auto-reply subject"
                className={FORM_INPUT}
              />
            </FormField>
            <FormField
              label="Message"
              hint="Hi {name}, thanks for your enquiry — we've got your details and will be in touch shortly."
            >
              <RichTextEditor theme="light" value={autoReplyBody} onChange={setAutoReplyBody} minHeight={120} />
            </FormField>
            {(!autoReplySubject.trim() || !autoReplyBody.trim()) && (
              <p className="text-xs text-slate-400">
                Add both a subject and a message — until then nothing sends.
              </p>
            )}
          </>
        )}
      </FormEditorSection>

      {/* Welcome email — sent when you accept an enquiry from this form and
          tick "email them a magic link". Greeting, branding and the expiry
          note stay templated; everything here is yours to edit. Blank fields
          fall back to the platform defaults. */}
      <FormEditorSection
        title="Welcome email"
        hint={
          <>
            Sent when you accept an enquiry from this form and choose to email them a login link.
            Use <code className="text-slate-500">{'{business}'}</code> and <code className="text-slate-500">{'{name}'}</code> to personalise.
          </>
        }
      >
        <FormField label="Subject">
          <input
            value={welcomeSubject}
            onChange={e => setWelcomeSubject(e.target.value)}
            placeholder={WELCOME_SUBJECT_PLACEHOLDER}
            aria-label="Welcome email subject"
            className={FORM_INPUT}
          />
        </FormField>
        <FormField label="Intro text" hint={WELCOME_INTRO_PLACEHOLDER}>
          <RichTextEditor theme="light" value={welcomeIntro} onChange={setWelcomeIntro} minHeight={120} />
        </FormField>
        <FormRowGroup>
          <FormToggleRow
            label="Show the “Access my diary” button"
            hint={welcomeShowDiaryButton
              ? 'The email includes a one-tap login button to their training diary.'
              : 'The email goes out as a plain welcome with no login link — invite them another way.'}
            checked={welcomeShowDiaryButton}
            onChange={setWelcomeShowDiaryButton}
          />
        </FormRowGroup>
        {welcomeShowDiaryButton && (
          <FormField label="Button label">
            <input
              value={welcomeButtonLabel}
              onChange={e => setWelcomeButtonLabel(e.target.value)}
              placeholder={WELCOME_BUTTON_PLACEHOLDER}
              aria-label="Welcome email button label"
              className={FORM_INPUT}
            />
          </FormField>
        )}
      </FormEditorSection>
      </>}
    </FormEditorShell>
    </div>

    {paletteSheetOpen && (
      <FullScreenSheet
        title="Add a field"
        sub="Tap one to put it on your form"
        onClose={() => setPaletteSheetOpen(false)}
      >
        {palette}
      </FullScreenSheet>
    )}
    </>
  )
}

// ─── The Forms screen ─────────────────────────────────────────────────────────

// Lightweight list-row shape for lead-capture (embed) forms — mirrors the
// former EmbedFormsCard's EmbedFormRow. Editing happens on the dedicated
// /forms/embed/* routes; here we just list them alongside session forms.
export interface EmbedFormRow {
  id: string
  title: string
  description: string | null
  isActive: boolean
  fieldCount: number
}

/** A unified client form — intake, website enquiry, or both. */
export interface ClientFormRow {
  id: string
  name: string
  description: string | null
  isActive: boolean
  usableAsIntake: boolean
  usableAsEnquiry: boolean
  questionCount: number
  assignedCount: number
  enquiryCount: number
}

// Plain words for what a form is FOR, in the order a trainer meets them.
// Deliberately a sentence fragment rather than tinted "Intake"/"Enquiry" chips
// — a row already says what it is, and a chip strip is the tell of a
// machine-made screen (AGENTS.md).
function clientFormUse(f: ClientFormRow): string {
  if (f.usableAsIntake && f.usableAsEnquiry) return 'Website enquiry + client intake'
  if (f.usableAsEnquiry) return 'Website enquiry form'
  if (f.usableAsIntake) return 'Client intake form'
  return 'Not in use yet'
}

export function FormsManager({
  initialSessionForms,
  embedForms,
  clientForms = [],
  intakeCustomFields,
  intakeFormPublished,
  intakeSectionOrder,
  intakeSystemFieldSections,
  businessRoles,
}: {
  initialSessionForms: SessionFormRow[]
  /** Lead-capture (embed) forms — null when the member can't manage forms. */
  embedForms: EmbedFormRow[] | null
  /** Unified client forms (the Form model). */
  clientForms?: ClientFormRow[]
  intakeCustomFields: IntakeCustomField[]
  intakeFormPublished: boolean
  intakeSectionOrder: { name: string; description: string | null }[]
  intakeSystemFieldSections: Partial<Record<'name' | 'email' | 'phone', string | null>>
  /** Roles picked during onboarding — pre-select the right starter packs. */
  businessRoles: string[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionForms = initialSessionForms
  // Opens straight after onboarding (?setup=fields), and any time from the
  // "Suggest fields" button. Never auto-opens for a trainer who already has
  // fields — they've been through this.
  const [wizardOpen, setWizardOpen] = useState(
    () => searchParams.get('setup') === 'fields' && intakeCustomFields.length === 0
  )
  // Forms and Fields are each a screenful, so they're tabs rather than one long
  // scroll — the forms list used to sit below the whole field editor, off-screen.
  // Arriving from onboarding (?setup=fields) starts on Fields, where the wizard is.
  const [view, setView] = useState<'forms' | 'fields'>(() => {
    if (searchParams.get('view') === 'fields') return 'fields'
    if (searchParams.get('view') === 'forms') return 'forms'
    return searchParams.get('setup') === 'fields' ? 'fields' : 'forms'
  })

  // Keep the sub-tab in the URL so a reload (or a link you send yourself) comes
  // back to the tab you were on, rather than bouncing to Forms mid-edit.
  function selectView(next: 'forms' | 'fields') {
    setView(next)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('view', next)
      history.replaceState(null, '', `${url.pathname}${url.search}`)
    }
  }
  const [isPublished, setIsPublished] = useState(intakeFormPublished)
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
        // The layout's onboarding FAB reads server-rendered state — without
        // this it keeps nagging "publish the intake form" after you have.
        router.refresh()
      }
    } finally {
      setTogglingPublished(false)
    }
  }

  const [converting, setConverting] = useState(false)
  const [convertError, setConvertError] = useState<string | null>(null)

  // Build a real intake form out of the field library and open it in the
  // builder. The server links each question to the field it already had, so this
  // adds a way to ASK them; it does not copy, move or delete a single field.
  async function convertFieldsToForm() {
    if (converting) return
    setConverting(true)
    setConvertError(null)
    try {
      const res = await fetch('/api/forms/from-fields', { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setConvertError(data?.error ?? 'Could not build the form.')
        return
      }
      router.push(`/forms/client/${data.id}`)
    } catch {
      setConvertError('Could not build the form.')
    } finally {
      setConverting(false)
    }
  }

  const intakeFieldCount = intakeCustomFields.length + 3 // + name/email/phone

  return (
    <div className="flex flex-col gap-4">
      {/* One view now, so no tab strip. The "fields" tab held a switchboard for
          the built-in client details and an editor for a trainer's own — both of
          which the form builder does, and better (Karl, 2026-07-30: "the system
          fields are just a result of the forms"). A field is created on the form
          that asks it. */}
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => router.push('/forms/new')}>
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          New form
        </Button>
      </div>

      {/* ── Your fields ──────────────────────────────────────────────────── */}
      {/* This used to sit INSIDE the forms list, styled like one of them, which
          is what made Karl ask "do we need this now?" and then "that should be
          an intake form" (2026-08-06). Both halves of that are answered here.

          It is not a form, so it no longer sits among them: a field is a COLUMN
          ON THE CLIENT'S RECORD, read by the profile, the clients list, reports,
          exports and email merge tags. Deleting the library would take all of
          that with it.

          What was true is that the ASKING should be a form — the fallback gate
          asks these fields raw, with no pages, no conditional questions and no
          preview. "Turn into a form" builds one that links to these same fields,
          so nothing already collected moves and nobody is asked twice. */}
      <div>
        <SectionLabel>Your fields</SectionLabel>
        <p className="mb-2 px-1 text-xs text-slate-400">
          The details kept on every client&rsquo;s record — read by their profile, the
          clients list, reports and exports.
        </p>
        <FlatBlock>
          <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <ListChecks className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
              <button
                type="button"
                onClick={() => selectView('fields')}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm font-medium text-slate-900">
                  {intakeFieldCount} field{intakeFieldCount === 1 ? '' : 's'}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                  Asked at sign-up when a client has no intake form of their own.
                </span>
                {convertError && (
                  <span className="mt-0.5 block text-xs text-red-600">{convertError}</span>
                )}
              </button>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1 pl-[30px] sm:pl-0">
              <button
                type="button"
                onClick={convertFieldsToForm}
                disabled={converting}
                className={FORM_QUIET_ACTION}
              >
                {converting ? 'Building…' : 'Turn into a form'}
              </button>
              <a
                href="/forms/intake/preview"
                target="_blank"
                rel="noopener noreferrer"
                className={FORM_QUIET_ACTION}
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                Preview
              </a>
              <button
                type="button"
                onClick={togglePublished}
                disabled={togglingPublished}
                className={FORM_QUIET_ACTION}
              >
                {isPublished ? 'Unpublish' : 'Publish'}
              </button>
            </div>
          </div>
        </FlatBlock>
      </div>

      {/* ── Forms ────────────────────────────────────────────────────────── */}
      {/* Grouped by WHO FILLS IT IN, which is the only distinction a trainer
          actually holds in their head — and the same split the "New form"
          screen offers. */}
      <section className="flex flex-col gap-5">
        <div>
          <SectionLabel>Client forms</SectionLabel>
          <p className="mb-2 px-1 text-xs text-slate-400">
            Questions your clients answer — on your website, or when you invite them.
          </p>
          <FlatBlock>
            {clientForms.map(f => (
              <Link
                key={f.id}
                href={`/forms/client/${f.id}`}
                className="flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50"
              >
                <ClipboardList className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{f.name}</span>
                  {!isRichTextEmpty(f.description) && (
                    <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                      {richTextToPlain(f.description)}
                    </span>
                  )}
                  <span className="mt-0.5 block truncate text-xs text-slate-400">
                    {clientFormUse(f)} · {f.questionCount} question{f.questionCount === 1 ? '' : 's'}
                    {f.assignedCount > 0 ? ` · ${f.assignedCount} sent` : ''}
                    {f.enquiryCount > 0 ? ` · ${f.enquiryCount} received` : ''}
                    {' · '}{f.isActive ? 'Published' : 'Draft'}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
              </Link>
            ))}

            {/* Lead-capture (embed) forms, the older way of putting a form on
                your own site. Nothing creates one any more — a client form set
                to "Website enquiry" does the same job with question types,
                conditional logic and pages — but the ones already embedded on
                trainers' sites stay editable here until they are folded into
                the client-form model. */}
            {(embedForms ?? []).map(f => (
              <Link
                key={f.id}
                href={`/forms/embed/${f.id}`}
                className="flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50"
              >
                <Globe className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{f.title}</span>
                  {!isRichTextEmpty(f.description) && (
                    <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                      {richTextToPlain(f.description)}
                    </span>
                  )}
                  <span className="mt-0.5 block truncate text-xs text-slate-400">
                    Lead-capture form · {f.fieldCount} field{f.fieldCount === 1 ? '' : 's'} ·{' '}
                    {f.isActive ? 'Published' : 'Draft'}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
              </Link>
            ))}
          </FlatBlock>
        </div>

        <div>
          <SectionLabel>Session forms</SectionLabel>
          <p className="mb-2 px-1 text-xs text-slate-400">
            Yours to fill in after a session — the answers become the client&apos;s report.
          </p>
          {sessionForms.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm text-slate-400">
              No session forms yet.
            </p>
          ) : (
            <FlatBlock>
              {sessionForms.map(f => (
                <Link
                  key={f.id}
                  href={`/forms/session/${f.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50"
                >
                  <FileText className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{f.name}</span>
                    {!isRichTextEmpty(f.description) && (
                      <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                        {richTextToPlain(f.description)}
                      </span>
                    )}
                    <span className="mt-0.5 block truncate text-xs text-slate-400">
                      {f.questions.length} question{f.questions.length === 1 ? '' : 's'}
                      {f.responses > 0 ? ` · ${f.responses} filled` : ''} · {f.isActive ? 'Published' : 'Draft'}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
                </Link>
              ))}
            </FlatBlock>
          )}
        </div>
      </section>
    </div>
  )
}
