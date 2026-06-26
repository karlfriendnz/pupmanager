'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Loader2, Check, Eye, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { emailBodyToHtml, htmlHasText } from '@/lib/email-html'

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
const fillTokens = (s: string) => Object.entries(SAMPLE).reduce((out, [k, v]) => out.split(k).join(v), s)

// Sentinel id for the pinned, non-deletable "Client invitation" entry. It is
// backed by TrainerProfile.inviteTemplate (saved via PATCH /api/trainer/profile),
// not the /api/email-templates CRUD, and has a body only (no subject).
const INVITE_ID = '__invite__'

const DEFAULT_INVITE_TEMPLATE = `Hi {{clientName}},

I'd like to invite you to PupManager to help us track {{dogName}}'s training progress.

Click below to get started!

Your Trainer`

type Draft = { id: string | null; name: string; category: string; subject: string; body: string; sortOrder: number }
const blankDraft = (): Draft => ({ id: null, name: '', category: '', subject: '', body: '', sortOrder: 0 })

export function EmailTemplatesPanel({ inviteTemplate }: { inviteTemplate: string | null }) {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [invite, setInvite] = useState<string>(inviteTemplate ?? DEFAULT_INVITE_TEMPLATE)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isInvite = draft?.id === INVITE_ID

  useEffect(() => {
    fetch('/api/email-templates')
      .then(r => r.json())
      .then(d => setTemplates(d.templates ?? []))
      .catch(() => setError('Failed to load templates.'))
  }, [])

  function open(t: Template | null) {
    setError(null)
    setSavedAt(null)
    setDraft(t
      ? { id: t.id, name: t.name, category: t.category ?? '', subject: t.subject, body: t.body, sortOrder: t.sortOrder }
      : blankDraft())
    setEditorKey(k => k + 1)
  }

  function openInvite() {
    setError(null)
    setSavedAt(null)
    setDraft({ id: INVITE_ID, name: 'Client invitation', category: '', subject: '', body: invite, sortOrder: -1 })
    setEditorKey(k => k + 1)
  }

  const patch = (p: Partial<Draft>) => setDraft(d => (d ? { ...d, ...p } : d))

  async function save() {
    if (!draft) return

    // Pinned invite entry: body only, min-20 chars, saved to TrainerProfile.
    if (draft.id === INVITE_ID) {
      if ((draft.body ?? '').trim().length < 20) {
        setError('The invite message must be at least 20 characters.')
        return
      }
      setSaving(true)
      setError(null)
      try {
        const res = await fetch('/api/trainer/profile', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ inviteTemplate: draft.body }),
        })
        if (!res.ok) throw new Error('Save failed')
        setInvite(draft.body)
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
          Use <code className="bg-slate-100 px-1 rounded text-slate-600">{'{{clientName}}'}</code>,{' '}
          <code className="bg-slate-100 px-1 rounded text-slate-600">{'{{dogName}}'}</code>,{' '}
          <code className="bg-slate-100 px-1 rounded text-slate-600">{'{{businessName}}'}</code> as placeholders.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        {/* Template picker — a wrapping row of pills, no inner sidebar. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => open(null)}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-600 hover:border-accent hover:text-accent transition-colors"
          >
            <Plus className="h-4 w-4" /> New template
          </button>
          {/* Pinned, non-deletable invite entry — backed by inviteTemplate. */}
          <button
            type="button"
            onClick={openInvite}
            title="The default copy sent when you invite a client"
            className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
              isInvite
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
            }`}
          >
            <Mail className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
            <span className="truncate max-w-[180px]">Client invitation</span>
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Default</span>
          </button>
          {templates === null && <span className="inline-flex items-center gap-2 text-sm text-slate-400 px-1"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</span>}
          {templates?.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => open(t)}
              title={t.subject}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
                draft?.id === t.id
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
              }`}
            >
              <Mail className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
              <span className="truncate max-w-[180px]">{t.name}</span>
            </button>
          ))}
        </div>

        {/* Editor — full width below the picker. */}
        {draft ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col gap-4">
            {isInvite ? (
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Client invitation</h3>
                <p className="mt-0.5 text-xs text-slate-500">The default copy sent when you invite a client.</p>
                <p className="mt-2 text-xs text-slate-400">
                  Use <code className="bg-slate-100 px-1 rounded">{'{{clientName}}'}</code> and{' '}
                  <code className="bg-slate-100 px-1 rounded">{'{{dogName}}'}</code> as placeholders.
                </p>
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
                  <input value={draft.subject} onChange={e => patch({ subject: e.target.value })} className={inputCls} placeholder="A warm welcome from {{businessName}}" />
                </Field>
              </>
            )}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Message</label>
              <RichTextEditor key={editorKey} theme="light" value={draft.body} onChange={html => patch({ body: html })} minHeight={200} />
            </div>

            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5"><Eye className="h-3.5 w-3.5" /> Preview (sample data)</p>
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                {!isInvite && (
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                    <p className="text-sm font-semibold text-slate-900 truncate">{fillTokens(draft.subject) || '(no subject)'}</p>
                  </div>
                )}
                <div className="bg-white p-5">
                  <div className="tiptap-body tiptap-light text-sm text-slate-800" dangerouslySetInnerHTML={{ __html: emailBodyToHtml(fillTokens(draft.body || '<p>(empty)</p>')) }} />
                </div>
              </div>
            </div>

            {error && <p className="text-sm text-rose-600">{error}</p>}

            <div className="flex items-center gap-3 pt-1">
              <Button type="button" onClick={save} loading={saving}>
                {!saving && <Check className="h-4 w-4" />}
                {isInvite ? 'Save template' : draft.id ? 'Save changes' : 'Create template'}
              </Button>
              {!isInvite && (
                <button type="button" onClick={remove} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50">
                  <Trash2 className="h-4 w-4" /> {draft.id ? 'Delete' : 'Discard'}
                </button>
              )}
              {savedAt && <span className="text-xs text-emerald-600">Saved</span>}
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
