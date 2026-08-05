'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, ExternalLink, Eye, Link2, Plus, Trash2, X } from 'lucide-react'
import { FormRunner } from '@/components/shared/form-runner'
import { ModalPortal } from '@/components/shared/modal-portal'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { isRichTextEmpty } from '@/lib/rich-text'
import {
  createQuestion, newQuestionId, serializeQuestions, validateForm,
} from '@/lib/session-form-builder'
import type { CustomFieldOption, FormStep, Question } from '@/lib/session-form-builder'
import {
  FORM_INPUT, FORM_QUIET_ACTION, FORM_TEXTAREA,
  FormEditorSection, FormField, FormRowGroup, FormToggleRow,
} from '../_form-editor-shell'
import { FormBuilder } from '../_form-builder'
import { CommsFlowEditor } from '@/components/trainer/comms-flow-editor'

// Platform default copy for the invite email, mirrored from src/lib/enquiries.ts
// (DEFAULT_WELCOME_*). Kept as literals because that module is server-only.
const INVITE_SUBJECT_PLACEHOLDER = 'Welcome to {business} — finish setting up your account'
const INVITE_BODY_PLACEHOLDER =
  'Thanks for registering with {business}. Click the button below to access your training diary — no password needed, the link logs you in automatically.'
const INVITE_BUTTON_PLACEHOLDER = 'Access my training diary'

export interface ClientFormInitial {
  id: string
  name: string
  description: string | null
  usableAsIntake: boolean
  usableAsEnquiry: boolean
  questions: Question[]
  steps: FormStep[]
  thankYouTitle: string | null
  thankYouMessage: string | null
  inviteSubject: string | null
  inviteBody: string | null
  inviteShowDiaryButton: boolean
  inviteButtonLabel: string | null
  isActive: boolean
  continueToAccount: boolean
  continueIntakeFormId: string | null
}

/** One of this trainer's other forms that could be asked after signing up. */
export interface IntakeFormOption {
  id: string
  name: string
  isActive: boolean
}

function newStepId() { return Math.random().toString(36).slice(2, 10) }

/**
 * The client-form editor — one screen for both jobs a client-filled form does:
 * an intake form assigned at invite time, and a public website enquiry form.
 * Which it is (or both) is two switches, not two editors.
 *
 * Runs the shared FormBuilder (`_form-builder.tsx`) — palette on the left, the
 * form on the right, settings on their own panel — which is the SAME builder the
 * session-form editor runs. Karl, 2026-08-02: "There should not be 2 different
 * interfaces." What differs between the two is props, not a second screen.
 */
export function ClientFormEditor({
  initial,
  customFields,
  intakeForms = [],
  newFormUse,
}: {
  initial: ClientFormInitial | null
  customFields: CustomFieldOption[]
  /** This trainer's intake forms, for the "and then ask them" picker. */
  intakeForms?: IntakeFormOption[]
  /**
   * Which job a BRAND-NEW form is being created for, from the door the trainer
   * came through on /forms/new. Only sets the starting position — both switches
   * are still on screen, so one form can still do both jobs.
   */
  newFormUse?: 'intake' | 'enquiry'
}) {
  const router = useRouter()
  const isNew = !initial

  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  // A new form starts set up for the job its door named. Intake stays the default
  // when no door said otherwise — it's the common case, and a form that is neither
  // can't be saved.
  const [asIntake, setAsIntake] = useState(initial?.usableAsIntake ?? newFormUse !== 'enquiry')
  const [asEnquiry, setAsEnquiry] = useState(initial?.usableAsEnquiry ?? newFormUse === 'enquiry')
  const [questions, setQuestions] = useState<Question[]>(
    initial?.questions ?? [createQuestion('SHORT_TEXT', newQuestionId())]
  )
  const [steps, setSteps] = useState<FormStep[]>(initial?.steps ?? [])
  const [previewing, setPreviewing] = useState(false)
  const [activeStep, setActiveStep] = useState<string | null>(initial?.steps?.[0]?.id ?? null)
  const [thankYouTitle, setThankYouTitle] = useState(initial?.thankYouTitle ?? '')
  const [thankYouMessage, setThankYouMessage] = useState(initial?.thankYouMessage ?? '')
  const [inviteSubject, setInviteSubject] = useState(initial?.inviteSubject ?? '')
  const [inviteBody, setInviteBody] = useState(initial?.inviteBody ?? '')
  const [inviteShowDiaryButton, setInviteShowDiaryButton] = useState(initial?.inviteShowDiaryButton ?? true)
  const [inviteButtonLabel, setInviteButtonLabel] = useState(initial?.inviteButtonLabel ?? '')
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [continueToAccount, setContinueToAccount] = useState(initial?.continueToAccount ?? false)
  const [continueIntakeFormId, setContinueIntakeFormId] = useState(initial?.continueIntakeFormId ?? '')
  const [togglingActive, setTogglingActive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Computed in an effect, not during render: reading window.location.origin
  // inline emits different HTML on the server and the client, and the
  // hydration mismatch silently drops every event handler on the page (this
  // is what once broke Save on the lead-capture editor).
  const [publicUrl, setPublicUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!initial) return
    setPublicUrl(`${window.location.origin}/form/${initial.id}`)
  }, [initial])

  const [copied, setCopied] = useState(false)
  function copyLink() {
    if (!publicUrl) return
    navigator.clipboard.writeText(publicUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Pages ──────────────────────────────────────────────────────────────
  // A form starts as one page. The first page a trainer adds turns the form
  // multi-step and sweeps the existing questions onto it, so nothing is
  // stranded on a page that doesn't exist.
  function addStep() {
    const step = { id: newStepId(), title: `Page ${steps.length + 1}` }
    if (steps.length === 0) {
      const first = { id: newStepId(), title: 'Page 1' }
      setQuestions(qs => qs.map(q => ({ ...q, step: first.id } as Question)))
      setSteps([first, step])
    } else {
      setSteps(prev => [...prev, step])
    }
    setActiveStep(step.id)
  }

  function removeStep(id: string) {
    const remaining = steps.filter(s => s.id !== id)
    // Questions on a deleted page move to the first surviving one rather than
    // vanishing — deleting a page must never quietly delete its questions.
    const rehome = remaining[0]?.id
    setQuestions(qs => qs.map(q => (q.step === id ? ({ ...q, step: rehome } as Question) : q)))
    setSteps(remaining.length === 1 ? [] : remaining)
    setActiveStep(remaining.length <= 1 ? null : (remaining[0]?.id ?? null))
  }

  async function save() {
    setError(null)
    const problem = validateForm(name, questions)
    if (problem) { setError(problem); return }
    if (!asIntake && !asEnquiry) {
      setError('Choose where this form is used — as an intake form, a website enquiry form, or both.')
      return
    }
    setSaving(true)
    const body = {
      name: name.trim(),
      description: isRichTextEmpty(description) ? null : description,
      usableAsIntake: asIntake,
      usableAsEnquiry: asEnquiry,
      questions: serializeQuestions(questions),
      steps,
      thankYouTitle: thankYouTitle.trim() || null,
      thankYouMessage: thankYouMessage.trim() || null,
      inviteSubject: inviteSubject.trim() || null,
      inviteBody: isRichTextEmpty(inviteBody) ? null : inviteBody,
      inviteShowDiaryButton,
      inviteButtonLabel: inviteButtonLabel.trim() || null,
      // Live state, so toggling Published then hitting Save keeps the toggle.
      isActive,
      // Only ever an enquiry form's business. Sent as false on an intake-only
      // form so switching "where it's used" off also switches the run off,
      // rather than leaving a setting live on a form that has no public link.
      continueToAccount: asEnquiry && continueToAccount,
      continueIntakeFormId: asEnquiry && continueToAccount ? continueIntakeFormId || null : null,
    }
    try {
      const res = await fetch(isNew ? '/api/forms' : `/api/forms/${initial!.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(typeof b.error === 'string' ? b.error : 'Could not save the form.')
        setSaving(false)
        return
      }
      router.push('/settings?tab=forms')
      router.refresh()
    } catch {
      setError('Could not save the form.')
      setSaving(false)
    }
  }

  async function onToggleActive() {
    if (!initial) return
    setTogglingActive(true)
    try {
      const res = await fetch(`/api/forms/${initial.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      })
      if (res.ok) setIsActive(v => !v)
    } finally {
      setTogglingActive(false)
    }
  }

  async function onDuplicate() {
    if (!initial) return
    setDuplicating(true)
    try {
      const res = await fetch(`/api/forms/${initial.id}/duplicate`, { method: 'POST' })
      if (res.ok) {
        const copy = await res.json()
        router.push(`/forms/client/${copy.id}`)
        router.refresh()
      }
    } finally {
      setDuplicating(false)
    }
  }

  async function onDelete() {
    if (!initial) return
    const res = await fetch(`/api/forms/${initial.id}`, { method: 'DELETE' })
    if (!res.ok) return
    router.push('/settings?tab=forms')
    router.refresh()
  }

  const stepFallback = steps[0]?.id ?? null

  return (
    <>
    {previewing && (
      // The preview IS the client's renderer, not a drawing of it — the same
      // FormRunner the intake gate and the public enquiry page use. A preview
      // built from its own markup is a preview that drifts, and the first thing
      // it stops showing you is the thing you changed.
      <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:p-6">
          <div className="no-scrollbar flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white sm:h-auto sm:max-h-[90vh] sm:rounded-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-3 backdrop-blur">
              <p className="text-sm font-semibold text-slate-900">Preview — what they will see</p>
              <button
                type="button"
                onClick={() => setPreviewing(false)}
                aria-label="Close preview"
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="p-5">
              <FormRunner
                form={{ id: initial?.id ?? 'preview', name, description, questions, steps }}
                /* The same map the intake gate builds, from the fields this
                   editor already has in hand. */
                linkedFields={Object.fromEntries(
                  customFields.map(f => [f.id, { label: f.label, type: f.type, options: f.options ?? [] }]),
                )}
                businessName=""
                trainerLogoUrl={null}
                heading={name || 'Your form'}
                /* Nothing is saved from a preview — it answers "what does this
                   look like", not "what happens when they send it". */
                onSubmit={async () => 'This is a preview — nothing was sent.'}
              />
            </div>
          </div>
        </div>
      </ModalPortal>
    )}
    <FormBuilder
      extraActions={
        <button
          type="button"
          onClick={() => setPreviewing(true)}
          className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
          Preview
        </button>
      }
      // Numbered steps rather than two tabs (Karl, 2026-08-05). A client form
      // has three real parts — what it is, what it asks, and what happens when
      // it comes back — and the tabs hid the third one behind a word most
      // people never pressed. The rail is clickable, so building your first
      // form is guided and fixing a typo in your tenth is still one click.
      wizard
      questions={questions}
      onChange={setQuestions}
      customFields={customFields}
      allowConditional
      minQuestions={1}
      activeStep={steps.length ? activeStep : null}
      stepFallback={stepFallback}
      questionsTitle={steps.length ? `Questions · ${steps.find(s => s.id === activeStep)?.title ?? 'Page 1'}` : 'Questions'}
      questionsHint="Drag a question by its handle to reorder it. A question can be set to only appear when an earlier answer matches."
      status={initial ? { isActive, busy: togglingActive, onToggle: onToggleActive } : undefined}
      statusActions={initial ? (
        <>
          {asEnquiry && publicUrl && (
            <>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer" className={FORM_QUIET_ACTION}>
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                Preview
              </a>
              <button type="button" onClick={copyLink} className={FORM_QUIET_ACTION}>
                {copied
                  ? <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
                  : <Link2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </>
          )}
          <button type="button" onClick={onDuplicate} disabled={duplicating} className={FORM_QUIET_ACTION}>
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
            {duplicating ? 'Duplicating…' : 'Duplicate'}
          </button>
        </>
      ) : undefined}
      error={error}
      onDelete={initial ? onDelete : undefined}
      onCancel={() => router.push('/settings?tab=forms')}
      onSave={save}
      saving={saving}
      saveLabel={initial ? 'Save changes' : 'Create form'}
      beforeQuestions={<>
      {/* Pages — a long intake reads better broken up, the way the field
          library's sections already are. Hidden until the trainer asks for it:
          most forms are one page and shouldn't pay for the concept. */}
      <FormEditorSection
        title="Pages"
        hint={steps.length === 0
          ? 'This form is one page. Split it up if it is getting long.'
          : 'Each page is one screen for whoever fills it in.'}
        action={
          <button type="button" onClick={addStep} className={FORM_QUIET_ACTION}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Add a page
          </button>
        }
      >
        {steps.length > 0 && (
          <FormRowGroup>
            {steps.map((s, i) => {
              const count = questions.filter(q => (q.step ?? stepFallback) === s.id).length
              return (
                <div key={s.id} className="flex items-center gap-2 py-2.5">
                  <button
                    type="button"
                    onClick={() => setActiveStep(s.id)}
                    aria-pressed={activeStep === s.id}
                    className={`flex-shrink-0 text-xs font-medium ${activeStep === s.id ? 'text-slate-900' : 'text-slate-400'}`}
                  >
                    {activeStep === s.id ? 'Editing' : 'Edit'}
                  </button>
                  <input
                    type="text"
                    value={s.title}
                    onChange={e => setSteps(st => st.map(x => (x.id === s.id ? { ...x, title: e.target.value } : x)))}
                    aria-label={`Title for page ${i + 1}`}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
                  />
                  <span className="flex-shrink-0 text-xs text-slate-400">
                    {count} question{count === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeStep(s.id)}
                    aria-label={`Remove page ${i + 1}`}
                    className="flex-shrink-0 p-1 text-slate-300 hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </div>
              )
            })}
          </FormRowGroup>
        )}
      </FormEditorSection>
      </>}
      above={<>
      <FormEditorSection title="Basics">
        <FormField label="Form name" required>
          <input
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setError(null) }}
            placeholder="e.g. New client intake"
            aria-label="Form name"
            className={FORM_INPUT}
          />
        </FormField>
        <FormField label="Intro" hint="Optional — shown above the questions, to whoever fills the form in.">
          <RichTextEditor
            value={description}
            onChange={html => setDescription(isRichTextEmpty(html) ? '' : html)}
            minHeight={120}
            theme="light"
          />
        </FormField>
      </FormEditorSection>

      <FormEditorSection
        title="Where it's used"
        hint="A form can do both — the same questions, asked in two places."
      >
        <FormRowGroup>
          <FormToggleRow
            label="Client intake form"
            hint="Pick it when you invite a client. They fill it in before they reach their home screen."
            checked={asIntake}
            onChange={v => { setAsIntake(v); setError(null) }}
          />
          <FormToggleRow
            label="Website enquiry form"
            hint="Gives the form a public link you can share or embed. Submissions land in your enquiries."
            checked={asEnquiry}
            onChange={v => { setAsEnquiry(v); setError(null) }}
          />
        </FormRowGroup>
      </FormEditorSection>

      </>}
      settingsLabel="Settings"
      settings={<>
      {asEnquiry && (
        <FormEditorSection
          title="After they submit"
          hint="Where the person ends up once they've filled this in."
        >
          <FormRowGroup>
            <FormToggleRow
              label="Take them straight on to setting up their account"
              hint={continueToAccount
                ? 'They pick a password, answer your intake form, and land on their own diary — all in one go. They are your client from that moment; there is nothing for you to accept.'
                : 'They see a thank-you message and wait for you. The enquiry lands in your list to accept or decline as usual.'}
              checked={continueToAccount}
              onChange={setContinueToAccount}
            />
          </FormRowGroup>

          {continueToAccount && (
            <FormField
              label="And then ask them"
              hint={
                intakeForms.length === 0
                  ? 'You have no intake forms yet. They will go straight to their diary until you make one.'
                  : 'Asked once, right after they pick a password. Leave it as “Nothing” to send them straight to their diary.'
              }
            >
              <select
                value={continueIntakeFormId}
                onChange={e => setContinueIntakeFormId(e.target.value)}
                aria-label="Intake form to ask after sign-up"
                className={FORM_INPUT}
                disabled={intakeForms.length === 0}
              >
                <option value="">Nothing — straight to their diary</option>
                {intakeForms.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name}{f.isActive ? '' : ' (draft)'}
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </FormEditorSection>
      )}

      {asEnquiry && !continueToAccount && (
        <FormEditorSection title="Success page" hint="What they see once they've hit submit.">
          <FormField label="Heading">
            <input
              type="text"
              value={thankYouTitle}
              onChange={e => setThankYouTitle(e.target.value)}
              placeholder="Thanks — we've got your details!"
              aria-label="Success page heading"
              className={FORM_INPUT}
            />
          </FormField>
          <FormField label="Body">
            <textarea
              value={thankYouMessage}
              onChange={e => setThankYouMessage(e.target.value)}
              rows={3}
              placeholder="We'll be in touch shortly."
              aria-label="Success page body"
              className={`${FORM_TEXTAREA} resize-none`}
            />
          </FormField>
        </FormEditorSection>
      )}

      {/* The journey this form starts.
          It lives on the LAST wizard step — the one that already answers "what
          happens when it comes back" — because that is the same question, one
          size up: not just where they land, but everything they walk through
          afterwards. Only on a saved enquiry form: a flow needs a form id to
          hang off, and a form nobody can submit has no journey to run. */}
      {asEnquiry && initial && (
        <section className="flex flex-col gap-3 px-4 py-4 sm:px-5 sm:py-5">
          <CommsFlowEditor formId={initial.id} offeringName={name} />
        </section>
      )}

      {asIntake && (
        <FormEditorSection
          title="Invitation email"
          hint={
            <>
              Sent when you invite a client and choose this form. Blank falls back to the platform
              copy. Use <code className="text-slate-500">{'{business}'}</code> and{' '}
              <code className="text-slate-500">{'{name}'}</code> to personalise.
            </>
          }
        >
          <FormField label="Subject">
            <input
              type="text"
              value={inviteSubject}
              onChange={e => setInviteSubject(e.target.value)}
              placeholder={INVITE_SUBJECT_PLACEHOLDER}
              aria-label="Invitation email subject"
              className={FORM_INPUT}
            />
          </FormField>
          <FormField label="Message" hint={INVITE_BODY_PLACEHOLDER}>
            <RichTextEditor
              theme="light"
              value={inviteBody}
              onChange={html => setInviteBody(isRichTextEmpty(html) ? '' : html)}
              minHeight={120}
            />
          </FormField>
          <FormRowGroup>
            <FormToggleRow
              label="Show the “Access my diary” button"
              hint={inviteShowDiaryButton
                ? 'The email includes a one-tap login button to their training diary.'
                : 'The email goes out as a plain welcome with no login link — invite them another way.'}
              checked={inviteShowDiaryButton}
              onChange={setInviteShowDiaryButton}
            />
          </FormRowGroup>
          {inviteShowDiaryButton && (
            <FormField label="Button label">
              <input
                type="text"
                value={inviteButtonLabel}
                onChange={e => setInviteButtonLabel(e.target.value)}
                placeholder={INVITE_BUTTON_PLACEHOLDER}
                aria-label="Invitation email button label"
                className={FORM_INPUT}
              />
            </FormField>
          )}
        </FormEditorSection>
      )}
      </>}
    />
    </>
  )
}
