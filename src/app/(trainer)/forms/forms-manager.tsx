'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import {
  Plus, Copy, Check, Trash2, Pencil, ExternalLink, Sparkles,
  Globe, ToggleLeft, ToggleRight, Code2, FileText,
  ClipboardList,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import type { FormRow as SessionFormRow } from './session/session-forms-manager'
import { SessionFormBuilderModal } from './session/session-form-builder-modal'
import { CustomFieldsManager } from '../settings/custom-fields-manager'
import { FieldPacksWizard } from '../settings/field-packs-wizard'

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
// embed code reveal. Save and delete redirect back to Settings → Fields & forms.
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

          {/* Styling — let the trainer match the form to their site's
              brand. Border toggle is useful for embeds where the parent
              page already provides framing; button colour overrides the
              platform blue for the submit CTA. */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Styling</p>
            <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setShowBorder(v => !v)}
                className="flex-shrink-0"
                aria-pressed={showBorder}
                aria-label="Toggle card border"
              >
                {showBorder
                  ? <ToggleRight className="h-5 w-5 text-blue-600" />
                  : <ToggleLeft className="h-5 w-5 text-slate-300" />}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">Card border</p>
                <p className="text-xs text-slate-500">A subtle border around each field group. Turn off when you&apos;re embedding inside a card on your own site.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-200">
              <input
                type="color"
                value={buttonColor}
                onChange={e => setButtonColor(e.target.value)}
                className="h-9 w-12 rounded-lg border border-slate-200 cursor-pointer bg-white"
                aria-label="Submit button colour"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">Submit button colour</p>
                <p className="text-xs text-slate-500 break-all">{buttonColor}{buttonColor.toLowerCase() === DEFAULT_BUTTON_COLOR ? ' (platform default)' : ''}</p>
              </div>
              {buttonColor.toLowerCase() !== DEFAULT_BUTTON_COLOR && (
                <button
                  type="button"
                  onClick={() => setButtonColor(DEFAULT_BUTTON_COLOR)}
                  className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
                >
                  Reset
                </button>
              )}
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

          {/* Auto-reply — goes to the PERSON WHO FILLED IN THE FORM, the
              moment they submit. Sits above the welcome email because it
              fires first in the timeline (submit → auto-reply, later:
              accept → welcome). Off by default so existing forms don't
              suddenly start emailing. */}
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Auto-reply email</p>
              <p className="text-xs text-slate-400 mt-1">
                Sent straight away to whoever fills in this form, so they aren&apos;t left wondering.
                Use <code className="text-slate-500">{'{business}'}</code> and <code className="text-slate-500">{'{name}'}</code> to personalise.
              </p>
            </div>

            {/* Three modes as segmented buttons — clearer than a dropdown
                for a choice that changes what's below it. */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
              {([
                { id: 'OFF' as const, label: "Don't send" },
                { id: 'TEMPLATE' as const, label: 'Use a template' },
                { id: 'CUSTOM' as const, label: 'Write my own' },
              ]).map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setAutoReplyMode(m.id)}
                  aria-pressed={autoReplyMode === m.id}
                  className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                    autoReplyMode === m.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {autoReplyMode === 'TEMPLATE' && (
              emailTemplates.length === 0 ? (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                  You haven&apos;t saved any email templates yet — add one under Settings → Email
                  templates, or choose &ldquo;Write my own&rdquo; instead.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700">Template</label>
                  <select
                    value={autoReplyTemplateId}
                    onChange={e => setAutoReplyTemplateId(e.target.value)}
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Choose a template…</option>
                    {emailTemplates.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.category ? `${t.category} · ${t.name}` : t.name}
                      </option>
                    ))}
                  </select>
                  {!autoReplyTemplateId && (
                    <p className="text-xs text-slate-400">Nothing sends until you pick one.</p>
                  )}
                </div>
              )
            )}

            {autoReplyMode === 'CUSTOM' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700">Subject</label>
                  <input
                    value={autoReplySubject}
                    onChange={e => setAutoReplySubject(e.target.value)}
                    placeholder="Thanks for getting in touch with {business}"
                    className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700">Message</label>
                  <RichTextEditor theme="light" value={autoReplyBody} onChange={setAutoReplyBody} minHeight={120} />
                  <p className="text-xs text-slate-400">
                    Hi {'{name}'}, thanks for your enquiry — we&apos;ve got your details and will be in
                    touch shortly.
                  </p>
                </div>
                {(!autoReplySubject.trim() || !autoReplyBody.trim()) && (
                  <p className="text-xs text-slate-400">
                    Add both a subject and a message — until then nothing sends.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Welcome email — sent when you accept an enquiry from this form
              and tick "email them a magic link". Greeting, branding, and
              the expiry note stay templated; everything here is yours to
              edit. Blank fields fall back to the platform defaults. */}
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Welcome email</p>
              <p className="text-xs text-slate-400 mt-1">
                Sent when you accept an enquiry from this form and choose to email them a login link.
                Use <code className="text-slate-500">{'{business}'}</code> and <code className="text-slate-500">{'{name}'}</code> to personalise.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Subject</label>
              <input
                value={welcomeSubject}
                onChange={e => setWelcomeSubject(e.target.value)}
                placeholder={WELCOME_SUBJECT_PLACEHOLDER}
                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Intro text</label>
              <RichTextEditor theme="light" value={welcomeIntro} onChange={setWelcomeIntro} minHeight={120} />
              <p className="text-xs text-slate-400">{WELCOME_INTRO_PLACEHOLDER}</p>
            </div>
            {/* Diary-button toggle. Off = a plain welcome with no login
                link — only do this if you're inviting them another way. */}
            <div className="flex items-center gap-3 p-3 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setWelcomeShowDiaryButton(v => !v)}
                className="flex-shrink-0"
                aria-pressed={welcomeShowDiaryButton}
                aria-label="Toggle diary access button"
              >
                {welcomeShowDiaryButton
                  ? <ToggleRight className="h-5 w-5 text-blue-600" />
                  : <ToggleLeft className="h-5 w-5 text-slate-300" />}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">Show the &ldquo;Access my diary&rdquo; button</p>
                <p className="text-xs text-slate-500">
                  {welcomeShowDiaryButton
                    ? 'The email includes a one-tap login button to their training diary.'
                    : 'The email goes out as a plain welcome with no login link — invite them another way.'}
                </p>
              </div>
            </div>
            {welcomeShowDiaryButton && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">Button label</label>
                <input
                  value={welcomeButtonLabel}
                  onChange={e => setWelcomeButtonLabel(e.target.value)}
                  placeholder={WELCOME_BUTTON_PLACEHOLDER}
                  className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
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

const TYPE_BADGE: Record<FormType, { label: string; cls: string; Icon: typeof Globe }> = {
  INTAKE: { label: 'Intake', cls: 'bg-amber-100 text-amber-700', Icon: ClipboardList },
  EMBED: { label: 'Embed', cls: 'bg-blue-100 text-blue-700', Icon: Globe },
  SESSION: { label: 'Session', cls: 'bg-violet-100 text-violet-700', Icon: FileText },
}
export function FormsManager({
  initialSessionForms,
  embedForms,
  intakeCustomFields,
  intakeFormPublished,
  intakeSectionOrder,
  intakeSystemFieldSections,
  businessRoles,
}: {
  initialSessionForms: SessionFormRow[]
  /** Lead-capture (embed) forms — null when the member can't manage forms. */
  embedForms: EmbedFormRow[] | null
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
  // New session forms are built in the two-pane builder modal; editing an
  // existing one still opens the full editor page (intro/closing/background
  // copy lives there).
  const [builderOpen, setBuilderOpen] = useState(false)

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

  const intakeFieldCount = intakeCustomFields.length + 3 // + name/email/phone

  return (
    <div className="flex flex-col gap-5">
      {wizardOpen && (
        <FieldPacksWizard roles={businessRoles} onClose={() => setWizardOpen(false)} />
      )}

      {builderOpen && (
        <SessionFormBuilderModal
          customFields={intakeCustomFields.map(f => ({
            id: f.id,
            label: f.label,
            type: f.type,
            appliesTo: f.appliesTo,
            category: f.category,
          }))}
          onClose={() => setBuilderOpen(false)}
        />
      )}

      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 w-fit">
        {(['forms', 'fields'] as const).map(v => (
          <button
            key={v}
            type="button"
            onClick={() => selectView(v)}
            aria-pressed={view === v}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
              view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {/* ── Fields ───────────────────────────────────────────────────────── */}
      <section className={`flex-col gap-3 ${view === 'fields' ? 'flex' : 'hidden'}`}>
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => setWizardOpen(true)}>
            <Sparkles className="h-4 w-4" />
            Suggest fields
          </Button>
        </div>

        <div>
          <CustomFieldsManager
            initialFields={intakeCustomFields}
            initialSectionOrder={intakeSectionOrder}
            initialSystemFieldSections={intakeSystemFieldSections}
            showSystemFields
          />
        </div>
      </section>

      {/* ── Forms ────────────────────────────────────────────────────────── */}
      <section className={`flex-col gap-3 ${view === 'forms' ? 'flex' : 'hidden'}`}>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setBuilderOpen(true)}>
            <Plus className="h-4 w-4" />
            New session form
          </Button>
        </div>

        {/* Intake form — a view of the fields above, not a separate question set. */}
        <div className="bg-white rounded-2xl border border-slate-200">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4">
            <TypeBadgeIcon type="INTAKE" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-slate-900 truncate">Intake form</p>
                <TypeBadge type="INTAKE" />
                <span className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                  isPublished ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {isPublished ? 'Published' : 'Draft'}
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-0.5">
                The first form a client fills in once you accept them. It asks for every field you set up.
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {intakeFieldCount} field{intakeFieldCount === 1 ? '' : 's'}
              </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 sm:ml-auto">
              <a
                href="/forms/intake/preview"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-600 hover:bg-blue-50"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Preview
              </a>
              <button
                type="button"
                onClick={togglePublished}
                disabled={togglingPublished}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
              >
                {isPublished ? 'Unpublish' : 'Publish'}
              </button>
            </div>
          </div>
        </div>

        {/* Session forms — their own questions, unrelated to the field library. */}
        {sessionForms.map(f => (
          <div key={f.id} className="bg-white rounded-2xl border border-slate-200">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4">
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
              <button
                onClick={() => router.push(`/forms/session/${f.id}`)}
                className="p-2 text-slate-400 hover:text-blue-600 transition-colors flex-shrink-0"
                title="Edit form"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}

        {/* Lead-capture (embed) forms — public forms a trainer embeds on their
            own website; a submission lands in their enquiries. Editing opens
            the dedicated /forms/embed/* route (embed URL + iframe snippet live
            there). Relocated here from Settings → Website. */}
        {embedForms != null && (
          <>
            <div className="flex items-center justify-between gap-3 mt-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900">Lead-capture forms</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Embed a form on your website — submissions land in your enquiries.
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => router.push('/forms/embed/new')}
                className="flex-shrink-0"
              >
                <Plus className="h-4 w-4" />
                New lead-capture form
              </Button>
            </div>

            {embedForms.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-400">
                No lead-capture forms yet.
              </p>
            ) : (
              embedForms.map(f => (
                <div key={f.id} className="bg-white rounded-2xl border border-slate-200">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4">
                    <TypeBadgeIcon type="EMBED" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900 truncate">{f.title}</p>
                        <TypeBadge type="EMBED" />
                        <span className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                          f.isActive ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {f.isActive ? 'Published' : 'Draft'}
                        </span>
                      </div>
                      {f.description && <p className="text-sm text-slate-400 truncate mt-0.5">{f.description}</p>}
                      <p className="text-xs text-slate-400 mt-1">
                        {f.fieldCount} field{f.fieldCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <button
                      onClick={() => router.push(`/forms/embed/${f.id}`)}
                      className="p-2 text-slate-400 hover:text-blue-600 transition-colors flex-shrink-0"
                      title="Edit form"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </section>
    </div>
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
