'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import Link from 'next/link'
import type { Editor } from '@tiptap/react'
import { Button } from '@/components/ui/button'
import { Mail, X, Send, ArrowLeft, ArrowRight, ShieldAlert, Users, Search, Check } from 'lucide-react'
import { EmailBodyBuilder, serializeBlocks, blocksHaveContent, seedBlocks, type EmailBlock } from '@/components/shared/email-body-builder'
import { emailBodyToHtml } from '@/lib/email-html'

type EmailTemplate = { id: string; name: string; category: string | null; subject: string; body: string }

// The email body builder (block model, serialize) is shared with the admin
// announcements composer — see @/components/shared/email-body-builder.

// A client the trainer can email (already filtered to mailable: real email,
// active, not opted out) — the pool the recipients step chooses from.
export type EmailCandidate = {
  id: string
  name: string | null
  email: string
  dogName?: string | null
  breed?: string | null
  classIds?: string[]
  custom?: Record<string, string> // customFieldId -> value
}

// Filter options the recipients step offers, derived from the candidate set by
// the server so the dropdowns only show breeds/classes/fields that actually
// apply. Optional — when absent only free-text search shows.
export type RecipientFacets = {
  breeds: string[]
  classes: { id: string; name: string }[]
  customFields: { id: string; label: string; values: string[] }[]
}

// Trainer branding the live preview mirrors (matches `buildClientEmail`).
export type ComposerBrand = {
  businessName: string
  logoUrl: string | null
  accentColor: string | null
}

// Placeholders the server substitutes per-recipient. Surfaced as insertable
// chips so the compose UX matches the single-client Messages composer.
const PLACEHOLDERS: { token: string; label: string }[] = [
  { token: '{{clientName}}', label: 'Client name' },
  { token: '{{trainerName}}', label: 'Your name' },
  { token: '{{businessName}}', label: 'Business name' },
  { token: '{{dogName}}', label: 'Dog name' },
]

const SKIP_REASON_LABELS: Record<string, string> = {
  NOT_FOUND: 'not found',
  SAMPLE: 'sample client',
  NO_EMAIL: 'no email address',
  OPTED_OUT: 'unsubscribed',
}

const DEFAULT_ACCENT = '#0d9488'
const VALID_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

interface BulkResult {
  broadcastId: string
  sent: number
  skipped: Array<{ clientId: string; reason: string }>
}

// Pure, testable: turn a 201 result into the "Sent to N · M skipped (reasons)"
// summary line. Exported for unit tests.
export function summarizeBulkResult(result: BulkResult): string {
  const parts = [`Sent to ${result.sent} ${result.sent === 1 ? 'client' : 'clients'}`]
  if (result.skipped.length > 0) {
    // Count skips by reason for a compact, human-readable breakdown.
    const counts = new Map<string, number>()
    for (const s of result.skipped) {
      counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1)
    }
    const reasons = Array.from(counts.entries())
      .map(([reason, n]) => `${n} ${SKIP_REASON_LABELS[reason] ?? reason.toLowerCase()}`)
      .join(', ')
    parts.push(`${result.skipped.length} skipped (${reasons})`)
  }
  return parts.join(' · ')
}

// Sample values so {{tokens}} read naturally in the live preview.
function sampleTokens(brand: ComposerBrand): Record<string, string> {
  const business = brand.businessName?.trim() || 'Your business'
  return {
    '{{clientName}}': 'Aria',
    '{{trainerName}}': business,
    '{{businessName}}': business,
    '{{dogName}}': 'Bailey',
  }
}
function fillSample(s: string, tokens: Record<string, string>): string {
  let out = s
  for (const [k, v] of Object.entries(tokens)) out = out.split(k).join(v)
  return out
}

// Compact labelled dropdown for the recipient filters. Empty value = "Any".
function FilterSelect({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={`Filter by ${label}`}
      className={`h-9 rounded-lg border bg-white px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)] ${
        value ? 'border-[var(--pm-brand-500)] text-[var(--pm-brand-700)]' : 'border-slate-200 text-slate-600'
      }`}
    >
      <option value="">{label}: Any</option>
      {options.map(o => <option key={o.value} value={o.value}>{label}: {o.label}</option>)}
    </select>
  )
}

// Live inbox preview mirroring the real branded email (`buildClientEmail`):
// accent strip → logo/business → body (serialized blocks) → footer/unsubscribe.
// Tokens are filled with sample values so it reads like a real send. The body is
// the SAME serialized HTML that is sent, so preview == send.
function EmailPreview({ subject, body, brand }: {
  subject: string
  body: string
  brand: ComposerBrand
}) {
  const tokens = sampleTokens(brand)
  const accent = brand.accentColor && VALID_HEX.test(brand.accentColor) ? brand.accentColor : DEFAULT_ACCENT
  const business = brand.businessName?.trim() || 'Your business'
  const initial = business.charAt(0).toUpperCase()
  const bodyHtml = body.trim() ? emailBodyToHtml(fillSample(body, tokens)) : ''
  const filledSubject = fillSample(subject, tokens)
  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
        <p className="text-sm font-semibold text-slate-900 truncate">{filledSubject || '(no subject)'}</p>
        <p className="text-xs text-slate-500 truncate">{business}</p>
      </div>
      <div style={{ background: '#F8FAFC', padding: 20 }}>
        <div style={{ background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 8px 24px rgba(15,23,42,0.08)', maxWidth: 560, margin: '0 auto' }}>
          <div style={{ height: 4, background: accent }} />
          <div style={{ textAlign: 'center', padding: '32px 32px 16px' }}>
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt={business} style={{ maxHeight: 88, maxWidth: 300, display: 'inline-block', border: 0 }} />
            ) : (
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 72, height: 72, borderRadius: 18, background: accent, color: '#fff', fontSize: 28, fontWeight: 700 }}>
                {initial}
              </div>
            )}
            <p style={{ margin: '12px 0 0', fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{business}</p>
          </div>
          {bodyHtml ? (
            <div
              className="tiptap-body tiptap-light"
              style={{ padding: '8px 32px 32px', color: '#0f172a', fontSize: 14, lineHeight: 1.6, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }}
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          ) : (
            <div style={{ padding: '8px 32px 32px', color: '#94a3b8', fontSize: 14 }}>Your message will appear here…</div>
          )}
          <div style={{ padding: '20px 32px', background: '#fafaf9', borderTop: '1px solid #f1f5f9' }}>
            <p style={{ margin: 0, fontSize: 13, color: '#475569' }}><strong style={{ color: '#0f172a' }}>{business}</strong></p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#94a3b8' }}>Hit reply to reach us directly.</p>
            <p style={{ margin: '10px 0 0', fontSize: 11, color: '#94a3b8' }}>You&rsquo;re receiving this because you&rsquo;re a client of {business}. <span style={{ textDecoration: 'underline' }}>Unsubscribe</span> from these emails.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

const STEPS = ['create', 'recipients', 'send'] as const
type Step = (typeof STEPS)[number]
const STEP_LABELS: Record<Step, string> = { create: 'Create email', recipients: 'Choose recipients', send: 'Send' }

export function EmailComposer({
  candidates,
  facets,
  initialSelectedIds,
  brand,
  mode,
  onSent,
  onCancel,
}: {
  candidates: EmailCandidate[]
  /** Structured filter options for the recipients step (breed/class/custom). */
  facets?: RecipientFacets
  /** Recipients ticked when the composer opens. Defaults to all candidates. */
  initialSelectedIds?: string[]
  /** Trainer branding mirrored by the live preview. */
  brand: ComposerBrand
  /** 'modal' = compact single column overlay; 'page' = two-pane with preview. */
  mode: 'modal' | 'page'
  /** Called after a successful send so the parent can clear selection + refresh. */
  onSent: (summary: string) => void
  /** Close (modal) / navigate away (page). */
  onCancel: () => void
}) {
  const [step, setStep] = useState<Step>('create')
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null)
  const [subject, setSubject] = useState('')
  const [blocks, setBlocks] = useState<EmailBlock[]>(seedBlocks)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedIds ?? candidates.map(c => c.id)),
  )
  const [recipientQuery, setRecipientQuery] = useState('')
  const [fBreed, setFBreed] = useState('')
  const [fClass, setFClass] = useState('')
  const [fCustom, setFCustom] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [domainBlocked, setDomainBlocked] = useState(false)

  // Editors keyed by block id so placeholders insert into the focused text block.
  const editorsRef = useRef<Map<string, Editor>>(new Map())
  const subjectRef = useRef<HTMLInputElement>(null)
  // Monotonic block-id source (no Math.random / Date.now). b0 is the seed block.
  const idRef = useRef(0)
  function nextId() { idRef.current += 1; return `b${idRef.current}` }
  const lastFocused = useRef<{ kind: 'subject' } | { kind: 'block'; id: string }>({ kind: 'block', id: 'b0' })

  const isPage = mode === 'page'
  const serializedBody = useMemo(() => serializeBlocks(blocks), [blocks])

  useEffect(() => {
    fetch('/api/email-templates')
      .then(r => r.json())
      .then(d => setTemplates(d.templates ?? []))
      .catch(() => setTemplates([]))
  }, [])

  const registerEditor = useCallback((id: string, editor: Editor) => { editorsRef.current.set(id, editor) }, [])

  function applyTemplate(id: string) {
    const t = templates?.find(x => x.id === id)
    if (!t) return
    setSubject(t.subject)
    const nid = nextId()
    editorsRef.current.clear() // old block editors are unmounting
    setBlocks([{ id: nid, type: 'text', html: t.body }])
    lastFocused.current = { kind: 'block', id: nid }
  }

  function insertPlaceholder(token: string) {
    const lf = lastFocused.current
    if (lf.kind === 'subject') {
      const el = subjectRef.current
      if (el) {
        const start = el.selectionStart ?? subject.length
        const end = el.selectionEnd ?? subject.length
        setSubject(subject.slice(0, start) + token + subject.slice(end))
        requestAnimationFrame(() => {
          el.focus()
          const pos = start + token.length
          el.setSelectionRange(pos, pos)
        })
        return
      }
    }
    // Insert into the focused text block, else the first text block.
    let editor = lf.kind === 'block' ? editorsRef.current.get(lf.id) : undefined
    if (!editor) {
      const firstText = blocks.find(b => b.type === 'text')
      editor = firstText ? editorsRef.current.get(firstText.id) : undefined
    }
    editor?.chain().focus().insertContent(token).run()
  }

  // Editor registration (for placeholder insertion) + block focus tracking are
  // wired into the shared EmailBodyBuilder below; block add/move/remove/upload
  // all live there now.
  function trackBlockFocus(id: string) { lastFocused.current = { kind: 'block', id } }

  // ── Recipients step helpers ────────────────────────────────────────────────
  const customFilters = useMemo(() => Object.entries(fCustom).filter(([, v]) => v), [fCustom])
  const filteredCandidates = useMemo(() => {
    const q = recipientQuery.trim().toLocaleLowerCase('en-NZ')
    return candidates.filter(c => {
      if (q && !`${c.name ?? ''} ${c.email} ${c.dogName ?? ''}`.toLocaleLowerCase('en-NZ').includes(q)) return false
      if (fBreed && c.breed !== fBreed) return false
      if (fClass && !(c.classIds ?? []).includes(fClass)) return false
      for (const [fieldId, value] of customFilters) {
        if ((c.custom?.[fieldId] ?? '') !== value) return false
      }
      return true
    })
  }, [candidates, recipientQuery, fBreed, fClass, customFilters])

  const selectedCount = selectedIds.size
  const allFilteredSelected = filteredCandidates.length > 0 && filteredCandidates.every(c => selectedIds.has(c.id))

  function toggleRecipient(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleSelectAllFiltered() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allFilteredSelected) filteredCandidates.forEach(c => next.delete(c.id))
      else filteredCandidates.forEach(c => next.add(c.id))
      return next
    })
  }

  // ── Navigation ──────────────────────────────────────────────────────────────
  function next() {
    setError(null)
    if (step === 'create') {
      if (!subject.trim() || !blocksHaveContent(blocks)) { setError('Add a subject and at least one text or image block before continuing.'); return }
      setStep('recipients'); return
    }
    if (step === 'recipients') {
      if (selectedCount === 0) { setError('Choose at least one recipient.'); return }
      setStep('send'); return
    }
  }
  function back() {
    setError(null)
    setStep(s => (s === 'send' ? 'recipients' : 'create'))
  }

  async function send() {
    setSending(true)
    setError(null)
    setDomainBlocked(false)
    try {
      const res = await fetch('/api/clients/email-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientIds: Array.from(selectedIds), subject, body: serializeBlocks(blocks) }),
      })
      const data = await res.json().catch(() => null)

      if (res.status === 201) { onSent(summarizeBulkResult(data as BulkResult)); return }
      if (res.status === 403 && data?.code === 'DOMAIN_NOT_VERIFIED') { setDomainBlocked(true); return }
      // 429 (TRIAL_LIMIT / DAILY_LIMIT), 400, 422 — server message explains it.
      setError(typeof data?.error === 'string' ? data.error : 'Could not send. Please try again.')
    } catch {
      setError('Network error — your email was not sent.')
    } finally {
      setSending(false)
    }
  }

  const stepIndex = STEPS.indexOf(step)

  const card = (
    <div className={isPage
      ? 'w-full bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col'
      : 'w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col'}>
      {/* Header + step indicator */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {step !== 'create' ? (
              <button type="button" onClick={back} disabled={sending} className="text-slate-400 hover:text-slate-600 -ml-1" aria-label="Back">
                <ArrowLeft className="h-5 w-5" />
              </button>
            ) : (
              <Mail className="h-4 w-4 text-[var(--pm-brand-600)] flex-shrink-0" />
            )}
            <h2 className="text-base font-semibold text-slate-900 truncate">{STEP_LABELS[step]}</h2>
          </div>
          {!isPage && (
            <button type="button" onClick={onCancel} disabled={sending} className="text-slate-400 hover:text-slate-600" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        {/* Step progress */}
        <ol className="mt-3 flex items-center gap-2" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2">
              <span
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  i < stepIndex ? 'bg-[var(--pm-brand-600)] text-white'
                  : i === stepIndex ? 'bg-[var(--pm-brand-600)] text-white'
                  : 'bg-slate-100 text-slate-400'
                }`}
              >
                {i < stepIndex ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className={`text-xs font-medium ${i === stepIndex ? 'text-slate-800' : 'text-slate-400'} hidden sm:block`}>
                {STEP_LABELS[s]}
              </span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-slate-100" />}
            </li>
          ))}
        </ol>
      </div>

      {/* Body */}
      <div className="px-5 py-4 flex flex-col gap-3 overflow-y-auto">
        {domainBlocked && (
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <ShieldAlert className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-amber-900">Set up sending before you send</p>
              <p className="text-amber-800 mt-0.5">
                Verify your own domain or use the PupManager test domain.{' '}
                <Link href="/marketing" onClick={onCancel} className="font-medium underline hover:no-underline">
                  Set up sending →
                </Link>
              </p>
            </div>
          </div>
        )}

        {/* ── Step 1: Create ─────────────────────────────────────────── */}
        {step === 'create' && (
          <>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Start from a template</label>
              <select
                className="w-full h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
                defaultValue=""
                onChange={e => { if (e.target.value) applyTemplate(e.target.value) }}
                disabled={sending}
              >
                <option value="">{templates === null ? 'Loading…' : templates.length ? 'Choose a template…' : 'No templates available'}</option>
                {templates?.map(t => (
                  <option key={t.id} value={t.id}>{t.category ? `${t.category} — ${t.name}` : t.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Subject</label>
              <input
                ref={subjectRef}
                value={subject}
                onChange={e => setSubject(e.target.value)}
                onFocus={() => { lastFocused.current = { kind: 'subject' } }}
                placeholder="Enter the subject of your email"
                className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
              />
            </div>

            {/* Placeholder chips — insert into the focused text block / subject. */}
            <div>
              <p className="text-xs font-medium text-slate-600 mb-1.5">Insert a placeholder</p>
              <div className="flex flex-wrap gap-1.5">
                {PLACEHOLDERS.map(p => (
                  <button
                    key={p.token}
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => insertPlaceholder(p.token)}
                    className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-[var(--pm-brand-500)] hover:text-[var(--pm-brand-700)]"
                    title={`Insert ${p.token}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Stacked block builder — text/image blocks in order (shared). */}
            <div className="flex flex-col gap-3">
              <label className="text-xs font-medium text-slate-600 block">Content blocks</label>
              <EmailBodyBuilder
                blocks={blocks}
                onBlocksChange={setBlocks}
                disabled={sending}
                onEditorReady={registerEditor}
                onBlockFocus={trackBlockFocus}
              />
            </div>
          </>
        )}

        {/* ── Step 2: Choose recipients ──────────────────────────────── */}
        {step === 'recipients' && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={recipientQuery}
                onChange={e => setRecipientQuery(e.target.value)}
                placeholder="Search clients by name, email or dog"
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
              />
            </div>

            {/* Structured filters (breed / class / custom fields) */}
            {facets && (facets.breeds.length > 0 || facets.classes.length > 0 || facets.customFields.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {facets.classes.length > 0 && (
                  <FilterSelect label="Class" value={fClass} onChange={setFClass}
                    options={facets.classes.map(c => ({ value: c.id, label: c.name }))} />
                )}
                {facets.breeds.length > 0 && (
                  <FilterSelect label="Breed" value={fBreed} onChange={setFBreed}
                    options={facets.breeds.map(b => ({ value: b, label: b }))} />
                )}
                {facets.customFields.map(f => (
                  <FilterSelect key={f.id} label={f.label}
                    value={fCustom[f.id] ?? ''}
                    onChange={v => setFCustom(prev => ({ ...prev, [f.id]: v }))}
                    options={f.values.map(v => ({ value: v, label: v }))} />
                ))}
                {(fBreed || fClass || customFilters.length > 0) && (
                  <button type="button" onClick={() => { setFBreed(''); setFClass(''); setFCustom({}) }}
                    className="text-xs font-medium text-slate-500 underline hover:no-underline self-center">
                    Clear filters
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <button type="button" onClick={toggleSelectAllFiltered} className="text-xs font-medium text-[var(--pm-brand-700)] hover:underline">
                {allFilteredSelected ? 'Clear all' : `Select all${recipientQuery ? ' shown' : ''} (${filteredCandidates.length})`}
              </button>
              <span className="text-xs text-slate-400">{selectedCount} selected</span>
            </div>
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {filteredCandidates.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-400">No matching clients.</p>
              ) : (
                filteredCandidates.map(c => {
                  const checked = selectedIds.has(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleRecipient(c.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
                    >
                      <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${checked ? 'bg-[var(--pm-brand-600)] border-[var(--pm-brand-600)] text-white' : 'border-slate-300'}`}>
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">{c.name ?? c.email}</span>
                        <span className="block truncate text-xs text-slate-400">{c.email}</span>
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </>
        )}

        {/* ── Step 3: Send ───────────────────────────────────────────── */}
        {step === 'send' && (
          <>
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
              <Users className="h-4 w-4 text-slate-500 flex-shrink-0" />
              <p className="text-sm text-slate-700">
                Sending to <span className="font-semibold">{selectedCount}</span> {selectedCount === 1 ? 'client' : 'clients'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Subject</p>
              <p className="text-sm font-semibold text-slate-900 break-words">{subject}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Message</p>
              <div
                className="tiptap-body tiptap-light rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-900 max-h-56 overflow-y-auto [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg"
                dangerouslySetInnerHTML={{ __html: serializedBody }}
              />
            </div>
            <p className="text-xs text-slate-400">
              Placeholders like <code className="text-slate-500">{'{{clientName}}'}</code> are filled in per recipient. Each
              email includes an unsubscribe link.
            </p>
          </>
        )}

        {error && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">{error}</p>}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3 flex-shrink-0">
        {step === 'create' ? (
          isPage ? (
            <Button type="button" variant="secondary" onClick={onCancel} disabled={sending}>Cancel</Button>
          ) : (
            <span className="text-xs text-slate-400 hidden sm:block">Step 1 of 3</span>
          )
        ) : (
          <Button type="button" variant="secondary" onClick={back} disabled={sending}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        )}
        {step === 'send' ? (
          <Button type="button" onClick={send} loading={sending} className="ml-auto">
            {!sending && <Send className="h-4 w-4" />}
            Send to {selectedCount}
          </Button>
        ) : (
          <Button type="button" onClick={next} disabled={sending} className="ml-auto">
            {step === 'create' ? 'Choose recipients' : 'Review & send'}
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )

  if (!isPage) return card

  // Page mode: composer on the left, live branded preview on the right.
  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
      {card}
      <div className="lg:sticky lg:top-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Live preview</p>
        <EmailPreview subject={subject} body={serializedBody} brand={brand} />
      </div>
    </div>
  )
}
