'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ImageUploadButton } from '@/components/image-uploader'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { isRichTextEmpty } from '@/lib/rich-text'
import {
  FORM_INPUT,
  FORM_TEXTAREA,
  FormEditorSection,
  FormEditorShell,
  FormField,
} from '../_form-editor-shell'
import { QuestionsSection } from '../_question-list'

// The question model + its pure helpers live in @/lib/session-form-builder
// (unit-tested there). Re-exported here so existing importers keep working.
export {
  isChoiceType,
  type ChoiceType,
  type CustomFieldOption,
  type Question,
  type QuestionType,
} from '@/lib/session-form-builder'
import {
  createQuestion,
  newQuestionId,
  serializeQuestions,
  validateForm,
} from '@/lib/session-form-builder'
import type { CustomFieldOption, Question } from '@/lib/session-form-builder'

export interface FormRow {
  id: string
  name: string
  description: string | null
  introText: string | null
  closingText: string | null
  backgroundColor: string | null
  backgroundUrl: string | null
  questions: Question[]
  responses: number
  isActive: boolean
}

// Note: the standalone SessionFormsManager has been removed — the unified
// FormsManager on /settings?tab=forms is the only entry point now, and editor
// pages live at /forms/session/new and /forms/session/[formId]. Both wear the
// same FormEditorShell as the lead-capture editor, so a trainer learns one
// screen no matter which kind of form they're building.

// ─── The editor ──────────────────────────────────────────────────────────────

// Page-style session form editor — same shell as the lead-capture editor.
// Save / delete redirect to /settings?tab=forms. Renders inside a route page
// that provides the chrome (back link / heading).
export function SessionFormEditor({
  existing,
  customFields,
}: {
  existing: FormRow | null
  customFields: CustomFieldOption[]
}) {
  const router = useRouter()
  // Local mirror of isActive so the toggle can update without a refresh
  // round-trip. New (no `existing`) forms default to active.
  const [isActive, setIsActive] = useState(existing?.isActive ?? true)
  const [togglingActive, setTogglingActive] = useState(false)
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [introText, setIntroText] = useState(existing?.introText ?? '')
  const [closingText, setClosingText] = useState(existing?.closingText ?? '')
  const [backgroundColor, setBackgroundColor] = useState(existing?.backgroundColor ?? '')
  const [backgroundUrl, setBackgroundUrl] = useState(existing?.backgroundUrl ?? '')
  const [questions, setQuestions] = useState<Question[]>(
    existing?.questions ?? [createQuestion('LONG_TEXT', newQuestionId())]
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const problem = validateForm(name, questions)
    if (problem) { setError(problem); return }
    setError(null)
    setSaving(true)

    const url = existing ? `/api/session-forms/${existing.id}` : '/api/session-forms'
    const res = await fetch(url, {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        introText: introText.trim() || null,
        closingText: closingText.trim() || null,
        backgroundColor: backgroundColor.trim() || null,
        backgroundUrl: backgroundUrl.trim() || null,
        questions: serializeQuestions(questions),
        // Use live state so toggling Published then clicking Save preserves it.
        isActive,
      }),
    })
    if (!res.ok) {
      setError('Could not save the form. Please try again.')
      setSaving(false)
      return
    }
    router.push('/settings?tab=forms')
    router.refresh()
  }

  async function onToggleActive() {
    if (!existing) return
    setTogglingActive(true)
    try {
      const res = await fetch(`/api/session-forms/${existing.id}`, {
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
    if (!existing) return
    const res = await fetch(`/api/session-forms/${existing.id}`, { method: 'DELETE' })
    if (!res.ok) return
    router.push('/settings?tab=forms')
    router.refresh()
  }

  return (
    <>
      <FormEditorShell
        status={existing ? { isActive, busy: togglingActive, onToggle: onToggleActive } : undefined}
        error={error}
        onDelete={existing ? onDelete : undefined}
        onCancel={() => router.push('/settings?tab=forms')}
        onSave={handleSave}
        saving={saving}
        saveLabel={existing ? 'Save changes' : 'Create form'}
      >
        <FormEditorSection title="Basics">
          <FormField label="Form name" required>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError(null) }}
              placeholder="e.g. First session report"
              aria-label="Form name"
              className={FORM_INPUT}
            />
          </FormField>
          <FormField
            label="Description"
            hint="Optional — internal. Shown to you when picking the form, never to the client."
          >
            <RichTextEditor
              value={description}
              onChange={html => setDescription(isRichTextEmpty(html) ? '' : html)}
              minHeight={120}
              theme="light"
            />
          </FormField>
        </FormEditorSection>

        <QuestionsSection
          questions={questions}
          onChange={setQuestions}
          customFields={customFields}
          showPrivateToggle
          minQuestions={1}
        />

        <FormEditorSection title="What the client sees" hint="Both optional — top and tail of their report.">
          <FormField label="Welcome / intro text">
            <textarea
              value={introText}
              onChange={e => setIntroText(e.target.value)}
              rows={3}
              placeholder="e.g. Thanks for our session today, Sarah! Here's a summary of what we covered…"
              aria-label="Welcome / intro text"
              className={FORM_TEXTAREA}
            />
          </FormField>
          <FormField label="Closing text">
            <textarea
              value={closingText}
              onChange={e => setClosingText(e.target.value)}
              rows={3}
              placeholder="e.g. See you next time! Reach out anytime if questions come up."
              aria-label="Closing text"
              className={FORM_TEXTAREA}
            />
          </FormField>
        </FormEditorSection>

        {/* Report background — colour wins when both blank, image takes
            priority on the report when set. The trainer can upload (same
            /api/upload/image route as session photos) or paste a URL. */}
        <FormEditorSection
          title="Report background"
          hint="Optional. Shown across the client-facing report — an image overrides the colour."
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              value={backgroundColor || '#ffffff'}
              onChange={e => setBackgroundColor(e.target.value)}
              aria-label="Background colour"
              className="h-10 w-12 cursor-pointer rounded-lg border border-slate-200"
            />
            <input
              type="text"
              value={backgroundColor}
              onChange={e => setBackgroundColor(e.target.value)}
              placeholder="#fef3c7 or blank"
              aria-label="Background colour hex"
              className="h-10 w-28 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
            />
            <input
              type="url"
              value={backgroundUrl}
              onChange={e => setBackgroundUrl(e.target.value)}
              placeholder="https://… or upload"
              aria-label="Background image URL"
              className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
            />
            <ImageUploadButton onUploaded={urls => urls[0] && setBackgroundUrl(urls[0])} />
          </div>
          {backgroundUrl && (
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={backgroundUrl}
                alt=""
                className="h-16 w-24 rounded-lg border border-slate-200 object-cover"
              />
              <button
                type="button"
                onClick={() => setBackgroundUrl('')}
                className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-red-500 hover:underline"
              >
                Remove image
              </button>
            </div>
          )}
        </FormEditorSection>
      </FormEditorShell>
    </>
  )
}

