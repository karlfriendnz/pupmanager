'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Megaphone, Send, Trash2, Pencil, X, Mail } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { readability, readingEase } from '@/lib/readability'
import { EmailBodyBuilder, serializeBlocks, blocksHaveContent, seedBlocks, type EmailBlock } from '@/components/shared/email-body-builder'
import { emailBodyToHtml } from '@/lib/email-html'

type Audience = 'ALL_TRAINERS' | 'ALL_CLIENTS' | 'EVERYONE'

type Announcement = {
  id: string
  title: string
  body: string
  link: string | null
  status: 'DRAFT' | 'SENT'
  audience: Audience
  sendEmail: boolean
  emailSubject: string | null
  emailHtml: string | null
  sentAt: string | null
  recipientCount: number | null
  emailRecipientCount: number | null
  createdAt: string
}

// A branded PupManager email preview (teal strip → logo → body). The body is the
// same serialized/sanitized HTML that is sent, so preview == send.
function EmailPreview({ subject, bodyHtml }: { subject: string; bodyHtml: string }) {
  const inner = bodyHtml.trim() ? emailBodyToHtml(bodyHtml) : ''
  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
        <p className="text-sm font-semibold text-slate-900 truncate">{subject || '(no subject)'}</p>
        <p className="text-xs text-slate-500">PupManager</p>
      </div>
      <div style={{ height: 4, background: '#2a9da9' }} />
      <div className="px-6 pt-5 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="https://app.pupmanager.com/email-logo.png" alt="PupManager" style={{ height: 34, display: 'inline-block' }} />
      </div>
      {inner ? (
        <div className="tiptap-body tiptap-light px-6 py-4 text-sm text-slate-900 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg" dangerouslySetInnerHTML={{ __html: inner }} />
      ) : (
        <div className="px-6 py-4 text-sm text-slate-400">Your email content will appear here…</div>
      )}
      <div className="px-6 py-3 bg-stone-50 border-t border-slate-100 text-center">
        <p className="text-[11px] text-slate-400">You&rsquo;re getting this because you use PupManager. <span className="underline">Unsubscribe</span></p>
      </div>
    </div>
  )
}

const AUDIENCES: { value: Audience; label: string; hint: string }[] = [
  { value: 'ALL_TRAINERS', label: 'Trainers', hint: 'Every trainer and team member' },
  { value: 'ALL_CLIENTS', label: 'Clients', hint: 'Every dog owner with an account' },
  { value: 'EVERYONE', label: 'Everyone', hint: 'Trainers and clients' },
]

const audienceLabel = (a: Audience) =>
  a === 'EVERYONE' ? 'everyone' : a === 'ALL_CLIENTS' ? 'all clients' : 'all trainers'

// How a trainer sees the announcement in their notification bell.
function BellPreview({ title, body, link }: { title: string; body: string; link: string | null }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--pm-brand-50,#eef2ff)] text-[var(--pm-brand-600,#4f46e5)]">
          <Megaphone className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{title || 'Your title shows here'}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">
            {body || 'Your message shows here.'}
          </p>
          {link && <p className="mt-1 text-xs font-medium text-[var(--pm-brand-600,#4f46e5)]">Tap to open →</p>}
        </div>
      </div>
    </div>
  )
}

export function AnnouncementsManager({ announcements }: { announcements: Announcement[] }) {
  const router = useRouter()
  const drafts = announcements.filter((a) => a.status === 'DRAFT')
  const sent = announcements.filter((a) => a.status === 'SENT')

  const [editId, setEditId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')
  const [audience, setAudience] = useState<Audience>('ALL_TRAINERS')
  const [sendEmail, setSendEmail] = useState(false)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBlocks, setEmailBlocks] = useState<EmailBlock[]>(seedBlocks)
  const [busy, setBusy] = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const emailBodyHtml = useMemo(() => serializeBlocks(emailBlocks), [emailBlocks])

  const read = useMemo(() => readability(body), [body])
  const ease = readingEase(read.grade)
  const easeColor = ease.tone === 'good' ? 'text-emerald-400' : ease.tone === 'ok' ? 'text-amber-400' : 'text-rose-400'

  function resetForm() {
    setEditId(null); setTitle(''); setBody(''); setLink(''); setAudience('ALL_TRAINERS'); setConfirmSend(false); setError(null)
    setSendEmail(false); setEmailSubject(''); setEmailBlocks(seedBlocks())
  }

  function startEdit(a: Announcement) {
    setEditId(a.id); setTitle(a.title); setBody(a.body); setLink(a.link ?? ''); setAudience(a.audience); setConfirmSend(false); setError(null)
    setSendEmail(a.sendEmail); setEmailSubject(a.emailSubject ?? '')
    // Reload the stored email HTML into a single rich block (round-trips losslessly
    // for the sent HTML; block separation isn't preserved, which is fine to edit).
    setEmailBlocks(a.emailHtml ? [{ id: 'b0', type: 'text', html: a.emailHtml }] : seedBlocks())
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Create a new draft or update the one being edited. Returns its id.
  async function saveDraft(): Promise<string | null> {
    setError(null)
    const payload = {
      title: title.trim(), body: body.trim(), link: link.trim(), audience,
      sendEmail,
      emailSubject: emailSubject.trim(),
      emailHtml: sendEmail ? emailBodyHtml : '',
    }
    const res = editId
      ? await fetch(`/api/admin/announcements/${editId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/admin/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Could not save. Check the title and message.'); return null }
    return data.announcement?.id ?? editId
  }

  async function handleSaveDraft() {
    setBusy(true)
    const id = await saveDraft()
    setBusy(false)
    if (id) { resetForm(); router.refresh() }
  }

  async function sendById(id: string) {
    const res = await fetch(`/api/admin/announcements/${id}/send`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Could not send.'); return false }
    return true
  }

  // Send from the compose form: save (create/update) first, then broadcast.
  async function handleSend() {
    setBusy(true)
    const id = await saveDraft()
    if (id && (await sendById(id))) { resetForm(); router.refresh() }
    setBusy(false)
  }

  async function handleDelete(id: string) {
    setBusy(true)
    await fetch(`/api/admin/announcements/${id}`, { method: 'DELETE' })
    if (editId === id) resetForm()
    setBusy(false)
    router.refresh()
  }

  async function handleSendDraft(id: string) {
    setBusy(true)
    if (await sendById(id)) router.refresh()
    setBusy(false)
  }

  const canSubmit = title.trim().length >= 3 && body.trim().length >= 1 && !busy
    && (!sendEmail || blocksHaveContent(emailBlocks))

  return (
    <div className="flex flex-col gap-8">
      {/* Compose */}
      <form
        onSubmit={(e) => { e.preventDefault() }}
        className="rounded-2xl border border-slate-700 bg-slate-800 p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-slate-200">{editId ? 'Edit draft' : 'New announcement'}</h2>
          {editId && (
            <button type="button" onClick={resetForm} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
              <X className="h-3.5 w-3.5" /> New instead
            </button>
          )}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Left: fields */}
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-slate-400">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Adding a client's address is easier"
                maxLength={120}
                className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-slate-400">Message</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="You can now type any address, even if it's not in the list. It saves right away."
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className={`text-xs ${easeColor}`}>
                {read.words > 0 ? `Reading level: Grade ${read.grade} — ${ease.label}` : 'Aim for short words and short sentences.'}
              </span>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-slate-400">Link (optional) — where tapping it goes, e.g. /settings?tab=addons</span>
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="/settings?tab=addons"
                className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <fieldset className="flex flex-col gap-1.5 text-sm">
              <span className="text-slate-400">Who gets this?</span>
              <div className="grid grid-cols-3 gap-2">
                {AUDIENCES.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => setAudience(a.value)}
                    aria-pressed={audience === a.value}
                    title={a.hint}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      audience === a.value
                        ? 'border-blue-500 bg-blue-600/20 text-white'
                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span className="block font-medium">{a.label}</span>
                    <span className="block text-[11px] text-slate-400">{a.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Email option — same audience, PupManager-branded, rich builder. */}
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-200"><Mail className="h-4 w-4" /> Also send this as an email</span>
              </label>
              {sendEmail && (
                <div className="mt-3 flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="text-slate-400">Email subject <span className="text-slate-500">(defaults to the title)</span></span>
                    <input
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      placeholder={title || 'Email subject'}
                      maxLength={200}
                      className="h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </label>
                  <span className="text-xs text-slate-400">Email content (images, formatting)</span>
                  {/* The builder is styled for a light surface — wrap it in white. */}
                  <div className="rounded-lg bg-white p-3">
                    <EmailBodyBuilder blocks={emailBlocks} onBlocksChange={setEmailBlocks} disabled={busy} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: live preview */}
          <div className="flex flex-col gap-2">
            <span className="text-sm text-slate-400">How it looks in the notification bell</span>
            <BellPreview title={title} body={body} link={link.trim() || null} />
            {sendEmail && (
              <>
                <span className="mt-2 text-sm text-slate-400">How the email looks</span>
                <EmailPreview subject={emailSubject.trim() || title} bodyHtml={emailBodyHtml} />
              </>
            )}
          </div>
        </div>

        {error && <p className="mt-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={!canSubmit}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-40"
          >
            {editId ? 'Save changes' : 'Save as draft'}
          </button>

          {!confirmSend ? (
            <button
              type="button"
              onClick={() => setConfirmSend(true)}
              disabled={!canSubmit}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
            >
              <Send className="h-4 w-4" /> Send to {audienceLabel(audience)}
            </button>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5">
              <span className="text-sm text-slate-300">Send to {audienceLabel(audience)} now?</span>
              <button type="button" onClick={handleSend} disabled={busy} className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40">
                {busy ? 'Sending…' : 'Yes, send'}
              </button>
              <button type="button" onClick={() => setConfirmSend(false)} disabled={busy} className="rounded-md px-2 py-1 text-sm text-slate-400 hover:text-white">
                Cancel
              </button>
            </div>
          )}
        </div>
      </form>

      {/* Drafts */}
      {drafts.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold text-slate-200">Drafts</h2>
          <div className="flex flex-col gap-3">
            {drafts.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-4 rounded-xl border border-slate-700 bg-slate-800 p-4">
                <div className="min-w-0">
                  <p className="font-medium text-white">{a.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-slate-400">{a.body}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => startEdit(a)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700" title="Edit">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button onClick={() => handleSendDraft(a.id)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40" title="Send">
                    <Send className="h-3.5 w-3.5" /> Send
                  </button>
                  <button onClick={() => handleDelete(a.id)} disabled={busy} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-rose-400" title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Sent history */}
      <section>
        <h2 className="mb-3 font-semibold text-slate-200">Sent</h2>
        {sent.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing sent yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {sent.map((a) => (
              <div key={a.id} className="rounded-xl border border-slate-700 bg-slate-800 p-4">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="font-medium text-white">{a.title}</p>
                  <span className="shrink-0 text-xs text-slate-500">
                    {a.sentAt ? formatDate(a.sentAt) : ''} · {a.recipientCount ?? 0} recipient{a.recipientCount === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-slate-400">{a.body}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
