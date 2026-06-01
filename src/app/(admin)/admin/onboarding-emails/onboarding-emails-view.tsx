'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Upload, Trash2, Loader2, Check, Eye, Send } from 'lucide-react'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { emailBodyToHtml } from '@/lib/email-html'

export type OnboardingEmailItem = {
  id: string
  key: string
  subject: string
  senderKey: string
  published: boolean
  triggerRule: unknown
  body: string
  topText: string | null
  imageUrl: string | null
  imageHeight: number | null
  sent: number
}

type TriggerRule = {
  type?: string
  hours?: number
  days?: number
  requireStepIncomplete?: string
  requireNoClientSignedIn?: boolean
}

function describeTrigger(raw: unknown): string {
  const r = (raw && typeof raw === 'object' ? raw : {}) as TriggerRule
  switch (r.type) {
    case 'on_signup': return 'Immediately on signup'
    case 'on_aha_reached': return 'When their first client signs in (aha moment)'
    case 'after_signup': return `${r.hours ?? '?'}h after signup${r.requireStepIncomplete ? ` — only if "${r.requireStepIncomplete}" still incomplete` : ''}`
    case 'after_first_invite_sent': return `${r.hours ?? '?'}h after first invite sent${r.requireNoClientSignedIn ? ' — only if no client has signed in' : ''}`
    case 'trial_days_left': return `${r.days} day${r.days === 1 ? '' : 's'} before the trial ends`
    case 'trial_ended': return 'When the trial ends'
    default: return JSON.stringify(raw)
  }
}

const isTrial = (e: OnboardingEmailItem) => e.key.startsWith('trial_')

// Sample values so {{tokens}} read naturally in the preview.
const SAMPLE_TOKENS: Record<string, string> = {
  '{{trainerName}}': 'Sarah',
  '{{businessName}}': 'Sarah’s Dog Training',
  '{{client_name}}': 'Aria',
  '{{clientName}}': 'Aria',
  '{{daysLeft}}': '3',
  '{{trialEndDate}}': 'Friday 14 June',
  '{{billingUrl}}': 'app.pupmanager.com/billing/plans',
}
function fillTokens(s: string): string {
  let out = s
  for (const [k, v] of Object.entries(SAMPLE_TOKENS)) out = out.split(k).join(v)
  return out
}

// Live inbox preview mirroring the real email layout (teal strip, logo, body,
// footer). Tokens are filled with sample values so it reads like a real send.
function EmailPreview({ subject, body, topText, senderKey, imageUrl, imageHeight }: { subject: string; body: string; topText: string | null; senderKey: string; imageUrl: string | null; imageHeight: number | null }) {
  const fromName = senderKey === 'brooke' ? 'Brooke' : 'Karl'
  const bodyHtml = emailBodyToHtml(fillTokens(body))
  const topHtml = topText?.trim() ? emailBodyToHtml(fillTokens(topText)) : ''
  return (
    <div className="rounded-2xl border border-slate-700 overflow-hidden">
      <div className="px-4 py-3 bg-slate-100 border-b border-slate-200">
        <p className="text-sm font-semibold text-slate-900 truncate">{fillTokens(subject) || '(no subject)'}</p>
        <p className="text-xs text-slate-500 truncate">{fromName} via PupManager &lt;noreply@pupmanager.com&gt;</p>
      </div>
      <div style={{ background: '#F8FAFC', padding: 20 }}>
        <div style={{ background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 8px 24px rgba(15,23,42,0.08)', maxWidth: 700, margin: '0 auto' }}>
          <div style={{ height: 4, background: '#2a9da9' }} />
          <div style={{ textAlign: 'center', padding: '24px 28px 8px' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/email-logo.png" alt="PupManager" width={190} style={{ display: 'inline-block', height: 'auto', maxWidth: 190 }} />
          </div>
          {topHtml && (
            <div style={{ padding: '16px 28px 0', color: '#0f172a', fontSize: 14, lineHeight: 1.6, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }} dangerouslySetInnerHTML={{ __html: topHtml }} />
          )}
          {imageUrl && (
            <div style={{ padding: '16px 28px 0', textAlign: 'center' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="" style={imageHeight
                ? { display: 'block', height: imageHeight, width: 'auto', maxWidth: '100%', margin: '0 auto', borderRadius: 12 }
                : { display: 'block', width: '100%', borderRadius: 12 }} />
            </div>
          )}
          <div style={{ padding: '18px 28px 8px', color: '#0f172a', fontSize: 14, lineHeight: 1.6, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          <div style={{ padding: '18px 28px', background: '#fafaf9', borderTop: '1px solid #f1f5f9', textAlign: 'center' }}>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#64748b' }}>Get the PupManager app on your phone</p>
            <a href="https://apps.apple.com/app/id6766399138" style={{ display: 'inline-block', margin: '0 3px' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/app-store-badge.png" alt="Download on the App Store" width={135} height={45} style={{ border: 0 }} />
            </a>
            <a href="https://play.google.com/store/apps/details?id=com.pupmanager.app" style={{ display: 'inline-block', margin: '0 3px' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/google-play-badge.png" alt="Get it on Google Play" width={135} height={45} style={{ border: 0 }} />
            </a>
            <p style={{ margin: '12px 0 0', fontSize: 12, color: '#94a3b8' }}>You’re receiving this because you signed up.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function OnboardingEmailsView({ emails }: { emails: OnboardingEmailItem[] }) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState(emails[0]?.id ?? '')
  const selected = emails.find(e => e.id === selectedId) ?? emails[0] ?? null

  const [form, setForm] = useState({ subject: '', body: '', topText: '', senderKey: 'karl', published: false, imageUrl: null as string | null, imageHeight: null as number | null })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Reset the edit form whenever a different email is selected.
  useEffect(() => {
    if (selected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({ subject: selected.subject, body: selected.body, topText: selected.topText ?? '', senderKey: selected.senderKey, published: selected.published, imageUrl: selected.imageUrl, imageHeight: selected.imageHeight })
      setSaved(false)
    }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!selected) return <p className="text-slate-500 py-8">No onboarding emails seeded.</p>

  const onboarding = emails.filter(e => !isTrial(e))
  const trial = emails.filter(isTrial)

  async function save() {
    setSaving(true); setSaved(false)
    try {
      const res = await fetch(`/api/admin/onboarding-emails/${selected!.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: form.subject, body: form.body, topText: form.topText, senderKey: form.senderKey, published: form.published, imageHeight: form.imageHeight }),
      })
      if (res.ok) { setSaved(true); router.refresh() }
      else alert('Save failed')
    } finally { setSaving(false) }
  }

  async function sendTest() {
    setTesting(true); setTested(false)
    try {
      const res = await fetch(`/api/admin/onboarding-emails/${selected!.id}/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: form.subject, body: form.body, topText: form.topText, senderKey: form.senderKey, imageUrl: form.imageUrl, imageHeight: form.imageHeight }),
      })
      if (res.ok) setTested(true)
      else alert('Test send failed')
    } finally { setTesting(false) }
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setUploading(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`/api/admin/onboarding-emails/${selected!.id}/image`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error()
      const { url } = await res.json()
      setForm(f => ({ ...f, imageUrl: url })); router.refresh()
    } catch { alert('Image upload failed. Make sure a Vercel Blob store is connected.') }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function removeImage() {
    setForm(f => ({ ...f, imageUrl: null }))
    await fetch(`/api/admin/onboarding-emails/${selected!.id}/image`, { method: 'DELETE' }).catch(() => {})
    router.refresh()
  }

  return (
    <div className="space-y-5">
      {/* Email picker */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-[11px] uppercase tracking-wide text-slate-400">Email</label>
        <select value={selected.id} onChange={e => setSelectedId(e.target.value)} className="h-10 min-w-[340px] rounded-xl bg-slate-800 border border-slate-700 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <optgroup label="Onboarding · activation">
            {onboarding.map(e => <option key={e.id} value={e.id}>{e.subject}{e.published ? '' : ' — draft'}</option>)}
          </optgroup>
          {trial.length > 0 && (
            <optgroup label="Trial · conversion">
              {trial.map(e => <option key={e.id} value={e.id}>{e.subject}{e.published ? '' : ' — draft'}</option>)}
            </optgroup>
          )}
        </select>
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
          <span className={cn('h-1.5 w-1.5 rounded-full', selected.published ? 'bg-green-400' : 'bg-slate-500')} />
          {selected.published ? 'Published' : 'Draft'} · {selected.sent} sent
        </span>
      </div>

      <div className="flex gap-6 items-start">
      {/* Left: editor (50%) */}
      <div className="w-1/2 min-w-0 bg-slate-800 rounded-2xl border border-slate-700 p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <p className="text-xs text-slate-500 font-mono">{selected.key} · {describeTrigger(selected.triggerRule)}</p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input type="checkbox" checked={form.published} onChange={e => setForm(f => ({ ...f, published: e.target.checked }))} className="h-4 w-4 accent-green-500" />
              Published
            </label>
            <select value={form.senderKey} onChange={e => setForm(f => ({ ...f, senderKey: e.target.value }))} className="h-9 rounded-lg bg-slate-900 border border-slate-700 px-2 text-sm text-white">
              <option value="karl">Voice: Karl</option>
              <option value="brooke">Voice: Brooke</option>
            </select>
          </div>
        </div>

        <label className="block text-xs text-slate-400 mb-1">Subject</label>
        <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} className="w-full h-11 rounded-xl bg-slate-900 border border-slate-700 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4" />

        <label className="block text-xs text-slate-400 mb-1">Text above image <span className="text-slate-600">(optional — shown between the logo and the image)</span></label>
        <div className="mb-4">
          <RichTextEditor key={`${selected.id}-top`} value={selected.topText ?? ''} onChange={html => setForm(f => ({ ...f, topText: html }))} minHeight={90} />
        </div>

        {/* Image */}
        <label className="block text-xs text-slate-400 mb-1">Image</label>
        <div className="mb-4 flex items-center gap-4">
          {form.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.imageUrl} alt="" className="h-20 w-32 rounded-lg object-cover border border-slate-700 bg-slate-900" />
          ) : (
            <div className="h-20 w-32 rounded-lg border border-dashed border-slate-600 flex items-center justify-center text-slate-600 text-xs">No image</div>
          )}
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 h-9 rounded-lg disabled:opacity-50">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {form.imageUrl ? 'Replace image' : 'Upload image'}
            </button>
            {form.imageUrl && (
              <button type="button" onClick={removeImage} className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-400 px-3 h-8 rounded-lg">
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onPickImage} />
          </div>
        </div>

        {form.imageUrl && (
          <div className="mb-4">
            <label className="block text-xs text-slate-400 mb-1">Image height</label>
            <div className="flex items-center gap-2">
              <input
                type="number" min={40} max={2000} step={10}
                value={form.imageHeight ?? ''}
                onChange={e => setForm(f => ({ ...f, imageHeight: e.target.value === '' ? null : (parseInt(e.target.value, 10) || null) }))}
                onBlur={e => {
                  const v = parseInt(e.target.value, 10)
                  setForm(f => ({ ...f, imageHeight: (e.target.value === '' || isNaN(v)) ? null : Math.max(40, Math.min(2000, v)) }))
                }}
                placeholder="Auto"
                className="w-28 h-9 rounded-lg bg-slate-900 border border-slate-700 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-xs text-slate-500">px {form.imageHeight ? '(scaled, no crop)' : '— blank = natural'}</span>
              {form.imageHeight && (
                <button type="button" onClick={() => setForm(f => ({ ...f, imageHeight: null }))} className="text-xs text-slate-400 hover:text-slate-200">Auto</button>
              )}
            </div>
          </div>
        )}

        <label className="block text-xs text-slate-400 mb-1">Body</label>
        <RichTextEditor key={selected.id} value={selected.body} onChange={html => setForm(f => ({ ...f, body: html }))} />

        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 h-10 rounded-xl disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saved && <span className="text-xs text-green-400">Saved ✓</span>}
          <button onClick={sendTest} disabled={testing} className="inline-flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium px-4 h-10 rounded-xl disabled:opacity-50" title="Send a test to karlfriend.nz@gmail.com">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {testing ? 'Sending…' : 'Send test'}
          </button>
          {tested && <span className="text-xs text-green-400">Sent to karlfriend.nz@gmail.com ✓</span>}
          <span className="text-xs text-slate-500 ml-auto">Tokens like <span className="font-mono">{'{{trainerName}}'}</span>, <span className="font-mono">{'{{businessName}}'}</span> are filled when sent.</span>
        </div>
      </div>

      {/* Right: live inbox preview (50%) */}
      <div className="w-1/2 min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-2"><Eye className="h-3.5 w-3.5" /> Preview — as sent</p>
        <EmailPreview subject={form.subject} body={form.body} topText={form.topText} senderKey={form.senderKey} imageUrl={form.imageUrl} imageHeight={form.imageHeight} />
      </div>
      </div>
    </div>
  )
}
