'use client'

import { useState } from 'react'
import { Loader2, CheckCircle2, Mail } from 'lucide-react'

// Public sign-up form for a lead magnet. Collects name + email + a REQUIRED
// consent tick, posts to the submit route, then shows an inline thank-you that
// tells the prospect to check their inbox for the download link.
export function PublicLeadMagnetForm({
  slug,
  magnetSlug,
  consentText,
  accent,
  showLabels = false,
  thankYouTitle,
  thankYouMessage,
}: {
  slug: string
  magnetSlug: string
  consentText: string
  accent: string
  showLabels?: boolean
  thankYouTitle: string | null
  thankYouMessage: string | null
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!consent) { setError('Please tick the box to continue.'); return }
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/c/${slug}/free/${magnetSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), consent }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(typeof body.error === 'string' ? body.error : 'Something went wrong — please try again.')
        return
      }
      setDone(true)
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl bg-emerald-50 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
        <h2 className="mt-3 text-base font-semibold text-slate-900">{thankYouTitle || 'Check your inbox!'}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {thankYouMessage || `We've emailed your download to ${email}. It should land in the next minute or two.`}
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-400">
          <Mail className="h-3.5 w-3.5" /> Don&apos;t see it? Check your spam folder.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        {showLabels && <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          required
          maxLength={120}
          className="h-11 w-full rounded-xl border border-slate-200 px-3.5 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
      </div>
      <div>
        {showLabels && <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          required
          maxLength={200}
          className="h-11 w-full rounded-xl border border-slate-200 px-3.5 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
      </div>
      <label className="flex items-start gap-2.5 py-1 text-left">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300"
        />
        <span className="text-xs leading-snug text-slate-500">{consentText}</span>
      </label>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="mt-1 flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
        style={{ background: accent }}
      >
        {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : 'Email me the download'}
      </button>
    </form>
  )
}
