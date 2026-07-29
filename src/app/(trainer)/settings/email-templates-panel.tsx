'use client'

import { useEffect, useRef, useState } from 'react'
import { Trash2, Loader2, Check, Eye, Mail, RotateCcw } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { emailBodyToHtml, htmlHasText } from '@/lib/email-html'
import { CLIENT_EMAIL_PLACEHOLDER_OPTIONS } from '@/lib/placeholder-labels'
import { PlaceholderButtons, insertTokenAtCursor } from '@/components/shared/placeholder-buttons'
import { EmailBodyBuilder, serializeBlocks, type EmailBlock } from '@/components/shared/email-body-builder'

type Template = {
  id: string
  name: string
  category: string | null
  subject: string
  body: string
  sortOrder: number
}

// Sample values so {{tokens}} read naturally in the preview.
const SAMPLE: Record<string, string> = {
  '{{clientName}}': 'Aria',
  '{{trainerName}}': 'you',
  '{{businessName}}': 'your business',
  '{{dogName}}': 'Bailey',
}
// Only fill the tokens the engine behind THIS template actually substitutes —
// the invite renderer knows two of the four, so its preview must leave the
// others visible rather than pretending they resolve.
const fillTokens = (s: string, options: readonly { token: string }[]) =>
  options.reduce((out, { token }) => out.split(token).join(SAMPLE[token] ?? token), s)


type Draft = {
  id: string | null; name: string; category: string; subject: string; body: string; sortOrder: number
  /** Set when this draft is one of OUR emails rather than a reusable template. */
  systemKey?: string | null
  /** Some system emails compose their own subject (the invite) — body only. */
  subjectEditable?: boolean
  /** That email's own tokens; a reusable template gets the generic set. */
  tokens?: readonly { token: string; label: string }[]
  /** Whether the trainer has already changed this one. */
  customised?: boolean
}
const blankDraft = (): Draft => ({ id: null, name: '', category: '', subject: '', body: '', sortOrder: 0 })

/** One of the platform's own emails, as the API describes it. */
type SystemEmail = {
  key: string; label: string; description: string
  trigger: 'manual' | 'action' | 'scheduled'
  placeholders: { token: string; label: string }[]
  subjectEditable: boolean
  subject: string; body: string
  defaultSubject: string; defaultBody: string
  /** What the editor loads. Null for one never edited — opens as one text block. */
  bodyBlocks: EmailBlock[] | null
  customised: boolean
}

const TRIGGER_LABEL: Record<SystemEmail['trigger'], string> = {
  manual: 'you send it',
  action: 'sends itself',
  scheduled: 'scheduled',
}

export function EmailTemplatesPanel() {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [systemEmails, setSystemEmails] = useState<SystemEmail[]>([])
  // The rendered email, straight from the same shell the senders use. Kept as
  // HTML for an iframe rather than rebuilt in React, so it cannot drift from
  // what actually lands in the inbox.
  const [preview, setPreview] = useState<{ html: string; from: string; subject: string } | null>(null)
  // Our emails are edited as blocks (text + images), the same builder the
  // marketing composer uses. The blocks are the edit format; the HTML they
  // serialise to is what sends, and is what every sender already reads.
  const [blocks, setBlocks] = useState<EmailBlock[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A system email is one of ours; everything else is a template the trainer
  // wrote. The difference drives what the editor shows and where Save goes.
  const isSystem = !!draft?.systemKey
  const sysDef = systemEmails.find(e => e.key === draft?.systemKey) ?? null
  // Placeholder insertion targets: the subject box and the body editor.
  const subjectRef = useRef<HTMLInputElement | null>(null)
  const bodyEditorRef = useRef<Editor | null>(null)
  // One editor per text block; the focused one is where a token lands.
  const blockEditorsRef = useRef<Map<string, Editor>>(new Map())
  const focusedBlockRef = useRef<string | null>(null)
  const lastFocused = useRef<'subject' | 'body'>('body')

  // Each system email declares the tokens its renderer actually substitutes;
  // offering the others would print them verbatim in a real send.
  const placeholderOptions = (draft?.tokens ?? CLIENT_EMAIL_PLACEHOLDER_OPTIONS) as readonly { token: string; label: string }[]

  // Inserts the raw token, unchanged — the button text is the only thing
  // that's been translated into plain language.
  function insertPlaceholder(token: string) {
    if (!draft) return
    if (lastFocused.current === 'subject' && draft.subjectEditable !== false) {
      patch({ subject: insertTokenAtCursor(subjectRef.current, draft.subject, token) })
      return
    }
    if (isSystem) {
      const ed = focusedBlockRef.current ? blockEditorsRef.current.get(focusedBlockRef.current) : null
      // Fall back to the first text block, so the button still does something
      // when nothing has been clicked into yet.
      const target = ed ?? [...blockEditorsRef.current.values()][0]
      target?.chain().focus().insertContent(token).run()
      return
    }
    bodyEditorRef.current?.chain().focus().insertContent(token).run()
  }

  useEffect(() => {
    fetch('/api/email-templates')
      .then(r => r.json())
      .then(d => setTemplates(d.templates ?? []))
      .catch(() => setError('Failed to load templates.'))
    fetch('/api/system-emails')
      .then(r => r.json())
      .then(d => setSystemEmails(d.emails ?? []))
      .catch(() => { /* the trainer's own templates still work without these */ })
  }, [])

  const systemKey = draft?.systemKey ?? null
  const subject = draft?.subject ?? ''
  // For one of ours the body follows the blocks, so the preview and the save
  // can never disagree with what is on screen.
  const body = systemKey ? serializeBlocks(blocks) : (draft?.body ?? '')
  // Re-render on a pause in typing. A system email only; a reusable template
  // has no fixed shell to show it in — it goes out inside whatever the
  // composer wraps it in.
  useEffect(() => {
    if (!systemKey) { setPreview(null); return }
    const key = systemKey
    const t = setTimeout(() => {
      setPreviewError(null)
      fetch('/api/system-emails/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, subject, body }),
      })
        .then(async r => {
          if (!r.ok) throw new Error(`Preview failed (${r.status})`)
          return r.json()
        })
        .then(d => { if (d?.html) setPreview(d); else throw new Error('Preview came back empty') })
        // Swallowing this left a spinner turning forever with nothing to go on.
        // The editor really does work without a preview — but say so.
        .catch(e => setPreviewError(e instanceof Error ? e.message : 'Preview unavailable'))
    }, 400)
    return () => clearTimeout(t)
  }, [systemKey, subject, body])

  function open(t: Template | null) {
    setError(null)
    setSavedAt(null)
    setDraft(t
      ? { id: t.id, name: t.name, category: t.category ?? '', subject: t.subject, body: t.body, sortOrder: t.sortOrder }
      : blankDraft())
    setEditorKey(k => k + 1)
  }

  function openSystem(e: SystemEmail) {
    setError(null)
    setSavedAt(null)
    // Saved blocks when there are some; otherwise the current wording as a
    // single text block, so an email nobody has touched still opens editable.
    setBlocks(
      e.bodyBlocks?.length
        ? e.bodyBlocks
        : [{ id: 'b0', type: 'text', html: e.body || '<p></p>' }],
    )
    setDraft({
      id: null, systemKey: e.key, name: e.label, category: '',
      subject: e.subject, body: e.body, sortOrder: -1,
      subjectEditable: e.subjectEditable, tokens: e.placeholders, customised: e.customised,
    })
    setEditorKey(k => k + 1)
  }

  // Put our wording back. Deleting the override IS the reset, so the sender
  // falls through to the default with nothing left behind.
  async function resetSystem() {
    if (!draft?.systemKey || !sysDef) return
    setSaving(true)
    try {
      await fetch(`/api/system-emails?key=${encodeURIComponent(draft.systemKey)}`, { method: 'DELETE' })
      const reverted = { ...sysDef, subject: sysDef.defaultSubject, body: sysDef.defaultBody, customised: false }
      setSystemEmails(list => list.map(e => (e.key === reverted.key ? reverted : e)))
      openSystem(reverted)
    } finally {
      setSaving(false)
    }
  }

  const patch = (p: Partial<Draft>) => setDraft(d => (d ? { ...d, ...p } : d))

  async function save() {
    if (!draft) return

    // One of ours: saved as an override against its key, not as a new template.
    if (draft.systemKey) {
      if (body.replace(/<[^>]*>/g, '').trim().length < 20 && !blocks.some(b => b.type === 'image')) {
        setError('The message must be at least 20 characters, or include an image.')
        return
      }
      setSaving(true)
      setError(null)
      try {
        const res = await fetch('/api/system-emails', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: draft.systemKey, subject: draft.subject, body, blocks }),
        })
        if (!res.ok) throw new Error('Save failed')
        setSystemEmails(list => list.map(e =>
          e.key === draft.systemKey ? { ...e, subject: draft.subject, body, bodyBlocks: blocks, customised: true } : e))
        patch({ customised: true })
        setSavedAt(Date.now())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed')
      } finally {
        setSaving(false)
      }
      return
    }

    if (!draft.name.trim() || !draft.subject.trim() || !htmlHasText(draft.body)) {
      setError('Name, subject and message are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const url = draft.id ? `/api/email-templates/${draft.id}` : '/api/email-templates'
      const res = await fetch(url, {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: draft.name, category: draft.category || null, subject: draft.subject, body: draft.body, sortOrder: draft.sortOrder }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Save failed')
      const saved = data.template as Template
      setTemplates(prev => {
        const list = prev ? [...prev] : []
        const i = list.findIndex(t => t.id === saved.id)
        if (i >= 0) list[i] = saved; else list.push(saved)
        return list.sort((a, b) => a.sortOrder - b.sortOrder)
      })
      setDraft(d => (d ? { ...d, id: saved.id } : d))
      setSavedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!draft?.id) { setDraft(null); return }
    if (!confirm(`Delete template "${draft.name}"?`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/email-templates/${draft.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setTemplates(prev => prev?.filter(t => t.id !== draft.id) ?? null)
      setDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-slate-500">
          Reusable email templates you can pick from when emailing a client (the ✉️ button in Messages).
          Add a placeholder — the client&apos;s name, the dog&apos;s name — and it fills itself in when the email goes out.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        {/* Template picker — one dropdown. As a wrapping row of pills it grew
            a line every few templates and pushed the editor off the screen,
            and "New template" sat at the front where the trainer's eye starts.
            Creating a new one is the last option, where you look after finding
            nothing that fits. */}
        <div className="flex items-center gap-2">
          <label htmlFor="pm-template-picker" className="sr-only">Choose an email template</label>
          <select
            id="pm-template-picker"
            value={draft?.systemKey ? `sys:${draft.systemKey}` : draft?.id ?? (draft ? '__new' : '')}
            disabled={templates === null}
            onChange={e => {
              const v = e.target.value
              if (v === '__new') { open(null); return }
              if (v.startsWith('sys:')) {
                const sys = systemEmails.find(x => x.key === v.slice(4))
                if (sys) openSystem(sys)
                return
              }
              const t = templates?.find(x => x.id === v)
              if (t) open(t)
            }}
            className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 disabled:opacity-60 sm:max-w-sm"
          >
            {!draft && <option value="">Choose an email…</option>}
            {/* Ours first — they are the ones that go out on their own. */}
            <optgroup label="Emails we send for you">
              {systemEmails.map(e => (
                <option key={e.key} value={`sys:${e.key}`}>
                  {e.label} · {e.customised ? 'your wording' : 'default'}
                </option>
              ))}
            </optgroup>
            <optgroup label="Your templates">
              {templates?.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
              {draft && !draft.id && !draft.systemKey && <option value="__new">New template (unsaved)</option>}
              <option value="__new">+ New template…</option>
            </optgroup>
          </select>
          {templates === null && (
            <span className="inline-flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </span>
          )}
        </div>

        {/* Two columns from lg up: what you're writing on the left, what it
            looks like on the right — the same shape as the marketing
            composer's page mode, so the two screens read the same way.
            Stacks on narrow screens, editor first. */}
        {draft ? (
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col gap-4 min-w-0">
            {isSystem ? (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{draft.name}</h3>
                  {sysDef && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      {TRIGGER_LABEL[sysDef.trigger]}
                    </span>
                  )}
                  {draft.customised && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      Your wording
                    </span>
                  )}
                </div>
                {sysDef && <p className="mt-0.5 text-xs text-slate-500">{sysDef.description}</p>}
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name">
                    <input value={draft.name} onChange={e => patch({ name: e.target.value })} className={inputCls} placeholder="Welcome to the pack" />
                  </Field>
                  <Field label="Category" hint="optional">
                    <input value={draft.category} onChange={e => patch({ category: e.target.value })} className={inputCls} placeholder="Onboarding" />
                  </Field>
                </div>
                <Field label="Subject">
                  <input ref={subjectRef} value={draft.subject} onFocus={() => { lastFocused.current = 'subject' }} onChange={e => patch({ subject: e.target.value })} className={inputCls} placeholder="A warm welcome to the pack" />
                </Field>
              </>
            )}
            {/* A system email keeps its subject editable unless the sender
                composes one (the invite builds its own from the business name). */}
            {isSystem && draft.subjectEditable !== false && (
              <Field label="Subject">
                <input ref={subjectRef} value={draft.subject} onFocus={() => { lastFocused.current = 'subject' }} onChange={e => patch({ subject: e.target.value })} className={inputCls} />
              </Field>
            )}
            <div onFocusCapture={() => { lastFocused.current = 'body' }}>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Message</label>
              {isSystem ? (
                /* Same builder the marketing composer uses — text and image
                   blocks in order, so these emails can look like the rest of
                   what the trainer sends rather than being the plain ones. */
                <EmailBodyBuilder
                  key={editorKey}
                  blocks={blocks}
                  onBlocksChange={setBlocks}
                  disabled={saving}
                  onEditorReady={(id, editor) => { blockEditorsRef.current.set(id, editor) }}
                  onBlockFocus={id => { lastFocused.current = 'body'; focusedBlockRef.current = id }}
                />
              ) : (
                <RichTextEditor key={editorKey} theme="light" value={draft.body} onEditorReady={editor => { bodyEditorRef.current = editor }} onChange={html => patch({ body: html })} minHeight={200} />
              )}
            </div>

            <PlaceholderButtons options={placeholderOptions} onInsert={insertPlaceholder} />

            {error && <p className="text-sm text-rose-600">{error}</p>}

            <div className="flex items-center gap-3 pt-1">
              <Button type="button" onClick={save} loading={saving}>
                {!saving && <Check className="h-4 w-4" />}
                {isSystem ? 'Save changes' : draft.id ? 'Save changes' : 'Create template'}
              </Button>
              {/* Ours can't be deleted — there is no such thing as a platform
                  without a "confirm your email". Putting our wording back is
                  the equivalent, and only means anything once it's changed. */}
              {isSystem ? (
                draft.customised && (
                  <button type="button" onClick={resetSystem} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">
                    <RotateCcw className="h-4 w-4" /> Back to the default
                  </button>
                )
              ) : (
                <button type="button" onClick={remove} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50">
                  <Trash2 className="h-4 w-4" /> {draft.id ? 'Delete' : 'Discard'}
                </button>
              )}
              {savedAt && <span className="text-xs text-emerald-600">Saved</span>}
            </div>
          </div>

          {/* Sticky so it stays beside a long message rather than scrolling
              away from the thing being edited. */}
          <div className="lg:sticky lg:top-4 min-w-0">
        {/* One of ours renders through the real shell — their logo, their
            colour, the actual layout — in an iframe, so what's on screen is
            the email rather than a second version of it that can drift.
            A reusable template has no fixed shell (the composer supplies
            one), so it keeps the simple body preview. */}
        {isSystem ? (
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              <Eye className="h-3.5 w-3.5" /> Preview — as it arrives
            </p>
            {preview ? (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  {draft.subjectEditable !== false && (
                    <p className="text-sm font-semibold text-slate-900 truncate">{preview.subject || '(no subject)'}</p>
                  )}
                  <p className="text-xs text-slate-500 truncate">{preview.from}</p>
                </div>
                <iframe
                  title="Email preview"
                  srcDoc={preview.html}
                  sandbox=""
                  className="w-full block bg-white"
                  style={{ height: 620, border: 0 }}
                />
              </div>
            ) : previewError ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                {previewError}. Your changes still save — this is only the preview.
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 grid place-items-center h-40 text-sm text-slate-400">
                <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Rendering…</span>
              </div>
            )}
          </div>
        ) : (
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5"><Eye className="h-3.5 w-3.5" /> Preview (sample data)</p>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                <p className="text-sm font-semibold text-slate-900 truncate">{fillTokens(draft.subject, placeholderOptions) || '(no subject)'}</p>
              </div>
              <div className="bg-white p-5">
                <div className="tiptap-body tiptap-light text-sm text-slate-800" dangerouslySetInnerHTML={{ __html: emailBodyToHtml(fillTokens(draft.body || '<p>(empty)</p>', placeholderOptions)) }} />
              </div>
            </div>
          </div>
        )}
          </div>
        </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 grid place-items-center min-h-[260px] text-center text-sm text-slate-400 p-6">
            <div>
              <Mail className="h-6 w-6 mx-auto mb-2 text-slate-300" />
              Select a template to edit, or create a new one.
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
        {label}{hint && <span className="ml-1.5 normal-case font-normal tracking-normal text-slate-400">· {hint}</span>}
      </label>
      {children}
    </div>
  )
}
