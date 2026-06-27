'use client'

import { useMemo, useState } from 'react'
import { upload } from '@vercel/blob/client'
import {
  Plus, Download, Loader2, Trash2, Pencil, ExternalLink, Copy, Check, Code2, Users, X, Upload, Mail,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'

interface Magnet {
  id: string
  slug: string
  title: string
  description: string | null
  headline: string | null
  intro: string | null
  fileUrl: string
  fileName: string
  fileSizeBytes: number | null
  consentText: string
  thankYouTitle: string | null
  thankYouMessage: string | null
  isActive: boolean
  subscriberCount: number
}

interface Subscriber {
  id: string
  email: string
  name: string | null
  status: 'SUBSCRIBED' | 'UNSUBSCRIBED' | 'BOUNCED'
  createdAt: string
  source: string | null
}

type Tab = 'downloads' | 'list'

export function LeadMagnetsManager({
  slug,
  subscribedCount,
  initialMagnets,
  initialSubscribers,
}: {
  slug: string
  subscribedCount: number
  initialMagnets: Magnet[]
  initialSubscribers: Subscriber[]
}) {
  const [tab, setTab] = useState<Tab>('downloads')
  const [magnets, setMagnets] = useState<Magnet[]>(initialMagnets)
  const [editing, setEditing] = useState<Magnet | null>(null)
  const [creating, setCreating] = useState(false)

  // Relative path is safe to render (no SSR/client origin mismatch); absolute
  // URLs are built at click time from window.location.origin.
  const publicPath = (m: Magnet) => `/c/${slug}/free/${m.slug}`

  function onSaved(saved: Magnet) {
    setMagnets((prev) => {
      const i = prev.findIndex((m) => m.id === saved.id)
      if (i === -1) return [saved, ...prev]
      const next = [...prev]; next[i] = saved; return next
    })
    setEditing(null); setCreating(false)
  }

  async function remove(id: string) {
    if (!confirm('Delete this lead magnet? Its captured subscribers stay on your list.')) return
    const prev = magnets
    setMagnets((p) => p.filter((m) => m.id !== id))
    const res = await fetch(`/api/trainer/lead-magnets/${id}`, { method: 'DELETE' })
    if (!res.ok) setMagnets(prev)
  }

  return (
    <>
      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-2xl bg-slate-100 p-1">
        <TabButton active={tab === 'downloads'} onClick={() => setTab('downloads')} icon={<Download className="h-4 w-4" />} label="Downloads" />
        <TabButton active={tab === 'list'} onClick={() => setTab('list')} icon={<Users className="h-4 w-4" />} label={`Mailing list (${subscribedCount})`} />
      </div>

      {tab === 'downloads' ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">Offer a free download behind a sign-up form. Each sign-up joins your mailing list.</p>
            <Button onClick={() => setCreating(true)}><Plus className="mr-1.5 h-4 w-4" /> New lead magnet</Button>
          </div>

          {magnets.length === 0 ? (
            <Card><CardBody className="py-12 text-center text-sm text-slate-400">No lead magnets yet — create your first free download.</CardBody></Card>
          ) : (
            magnets.map((m) => (
              <MagnetCard key={m.id} magnet={m} path={publicPath(m)} onEdit={() => setEditing(m)} onDelete={() => remove(m.id)} />
            ))
          )}
        </div>
      ) : (
        <SubscriberList initial={initialSubscribers} />
      )}

      {(creating || editing) && (
        <MagnetEditor magnet={editing} onClose={() => { setEditing(null); setCreating(false) }} onSaved={onSaved} />
      )}
    </>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
    >
      {icon}{label}
    </button>
  )
}

function CopyButton({ getText, label, icon }: { getText: () => string; label: string; icon: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => { await navigator.clipboard.writeText(getText()); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : icon}{copied ? 'Copied' : label}
    </button>
  )
}

// Build the paste-on-your-site embed: an iframe to the framable landing PLUS a
// real "Powered by PupManager" anchor in the parent DOM (the SEO backlink).
function buildEmbed(absUrl: string): string {
  return `<iframe src="${absUrl}?embed=1" width="100%" height="520" style="border:0;max-width:480px" title="Free download"></iframe>
<p style="font:12px sans-serif;color:#64748b;text-align:center;max-width:480px">🐾 Powered by <a href="https://pupmanager.com" style="color:#0d9488">PupManager — software for dog trainers</a></p>`
}

function MagnetCard({ magnet: m, path, onEdit, onDelete }: { magnet: Magnet; path: string; onEdit: () => void; onDelete: () => void }) {
  const [showEmbed, setShowEmbed] = useState(false)
  const absUrl = () => (typeof window === 'undefined' ? path : window.location.origin + path)
  return (
    <Card>
      <CardBody className="py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-slate-900">{m.title}</h3>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${m.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {m.isActive ? 'Live' : 'Off'}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-400">{m.fileName} · {m.subscriberCount} sign-up{m.subscriberCount === 1 ? '' : 's'}</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            <button onClick={onEdit} aria-label="Edit" className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
            <button onClick={onDelete} aria-label="Delete" className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a href={path} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <ExternalLink className="h-3.5 w-3.5" /> Open page
          </a>
          <CopyButton getText={absUrl} label="Copy link" icon={<Copy className="h-3.5 w-3.5" />} />
          <button onClick={() => setShowEmbed((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <Code2 className="h-3.5 w-3.5" /> Embed
          </button>
        </div>

        {showEmbed && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3">
            <p className="mb-2 text-xs text-slate-500">Paste this on your website. The “Powered by PupManager” line links back to us — keep it to help us both grow.</p>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-white p-2.5 text-[11px] text-slate-700 ring-1 ring-slate-200">{buildEmbed(absUrl())}</pre>
            <div className="mt-2"><CopyButton getText={() => buildEmbed(absUrl())} label="Copy embed code" icon={<Copy className="h-3.5 w-3.5" />} /></div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function MagnetEditor({ magnet, onClose, onSaved }: { magnet: Magnet | null; onClose: () => void; onSaved: (m: Magnet) => void }) {
  const [title, setTitle] = useState(magnet?.title ?? '')
  const [description, setDescription] = useState(magnet?.description ?? '')
  const [consentText, setConsentText] = useState(magnet?.consentText ?? 'I agree to receive emails and accept the privacy policy.')
  const [isActive, setIsActive] = useState(magnet?.isActive ?? true)
  const [fileUrl, setFileUrl] = useState(magnet?.fileUrl ?? '')
  const [fileName, setFileName] = useState(magnet?.fileName ?? '')
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(magnet?.fileSizeBytes ?? null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null); setUploading(true)
    try {
      const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/trainer/lead-magnets/upload' })
      setFileUrl(blob.url); setFileName(file.name); setFileSizeBytes(file.size)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Try a smaller file.')
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    if (!title.trim()) { setError('Give your download a title.'); return }
    if (!fileUrl) { setError('Upload the file people will receive.'); return }
    setError(null); setSaving(true)
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        consentText: consentText.trim() || undefined,
        fileUrl, fileName, fileSizeBytes,
        isActive,
      }
      const res = magnet
        ? await fetch(`/api/trainer/lead-magnets/${magnet.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/trainer/lead-magnets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(typeof body.error === 'string' ? body.error : 'Could not save. Please try again.'); return }
      const m = body.leadMagnet
      onSaved({ ...m, subscriberCount: magnet?.subscriberCount ?? 0 })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{magnet ? 'Edit lead magnet' : 'New lead magnet'}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">
          <div className="flex flex-col gap-4">
            <Field label="Title">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 5 tips for a calm puppy" maxLength={140} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
            </Field>
            <Field label="Short description" hint="Shown on the sign-up page.">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} className="w-full resize-y rounded-xl border border-slate-200 p-3 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
            </Field>
            <Field label="The download" hint="PDF, doc or image — up to 50 MB.">
              {fileUrl ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-slate-700"><Download className="h-4 w-4 flex-shrink-0 text-slate-400" /><span className="truncate">{fileName}</span></span>
                  <label className="flex-shrink-0 cursor-pointer text-xs font-medium text-blue-600 hover:underline">
                    Replace<input type="file" className="hidden" onChange={onPickFile} />
                  </label>
                </div>
              ) : (
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-6 text-sm text-slate-500 hover:bg-slate-50">
                  {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</> : <><Upload className="h-4 w-4" /> Upload file</>}
                  <input type="file" className="hidden" onChange={onPickFile} disabled={uploading} />
                </label>
              )}
            </Field>
            <Field label="Consent text" hint="Shown beside the required tick box.">
              <textarea value={consentText} onChange={(e) => setConsentText(e.target.value)} rows={2} maxLength={500} className="w-full resize-y rounded-xl border border-slate-200 p-3 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
            </Field>
            <label className="flex items-center gap-2.5">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              <span className="text-sm text-slate-700">Live — accepting sign-ups</span>
            </label>
            {error && <p className="text-sm text-rose-600">{error}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={uploading}>{magnet ? 'Save' : 'Create'}</Button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      {hint && <p className="mb-1.5 text-xs text-slate-400">{hint}</p>}
      {children}
    </div>
  )
}

function SubscriberList({ initial }: { initial: Subscriber[] }) {
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? initial.filter((s) => s.email.toLowerCase().includes(needle) || (s.name ?? '').toLowerCase().includes(needle)) : initial
  }, [q, initial])

  function exportCsv() {
    const header = ['Email', 'Name', 'Status', 'Source', 'Signed up']
    const lines = [header, ...rows.map((s) => [s.email, s.name ?? '', s.status, s.source ?? '', new Date(s.createdAt).toISOString().slice(0, 10)])]
    const csv = lines.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'mailing-list.csv'; a.click(); URL.revokeObjectURL(url)
  }

  if (initial.length === 0) {
    return <Card><CardBody className="py-12 text-center text-sm text-slate-400">No subscribers yet. Share a lead magnet to start growing your list.</CardBody></Card>
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email or name…" className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
        <Button variant="secondary" onClick={exportCsv}>Export CSV</Button>
      </div>
      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-slate-100">
            {rows.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Mail className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{s.name || s.email}</p>
                    <p className="truncate text-xs text-slate-400">{s.name ? s.email : (s.source ? `via ${s.source}` : 'Subscriber')}</p>
                  </div>
                </div>
                <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${s.status === 'SUBSCRIBED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {s.status === 'SUBSCRIBED' ? 'Subscribed' : s.status === 'UNSUBSCRIBED' ? 'Unsubscribed' : 'Bounced'}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  )
}
