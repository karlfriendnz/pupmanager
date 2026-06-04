'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link2, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'

// "Client login link" — the shareable, branded sign-in page a trainer drops
// onto their own website. Shows the full URL with a copy button and lets them
// customise the slug. `embedded` drops the outer card chrome + title when it
// already sits inside an accordion/section.
export function ClientLoginLinkCard({
  slug,
  baseUrl,
  embedded = false,
}: {
  slug: string | null
  baseUrl: string
  embedded?: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState(slug ?? '')
  const [savedSlug, setSavedSlug] = useState(slug)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const origin = baseUrl.replace(/\/$/, '')
  const fullUrl = savedSlug ? `${origin}/c/${savedSlug}` : null
  const dirty = value.trim() !== (savedSlug ?? '') && value.trim().length > 0

  async function copy() {
    if (!fullUrl) return
    try {
      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy — select and copy the link manually.')
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/trainer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: value.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Could not save that link. Try a different one.')
        return
      }
      const profile = await res.json().catch(() => ({}))
      const next = (profile?.slug as string | undefined) ?? value.trim()
      setSavedSlug(next)
      setValue(next)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={embedded ? '' : 'rounded-2xl border border-slate-200 bg-white p-5'}>
      {!embedded && (
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-slate-500" aria-hidden />
          <h3 className="text-sm font-semibold text-slate-900">Client login link</h3>
        </div>
      )}
      <p className={embedded ? 'text-sm text-slate-500' : 'mt-1 text-sm text-slate-500'}>
        A sign-in page branded to your business. Add it to your website so clients can log in.
      </p>

      {error && <Alert variant="error" className="mt-3">{error}</Alert>}

      {fullUrl && (
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 truncate rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            {fullUrl}
          </div>
          <Button type="button" variant="secondary" size="md" onClick={copy} className="shrink-0">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      )}

      <label htmlFor="client-login-slug" className="mt-4 block text-xs font-medium text-slate-700">
        Customise the link
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-sm text-slate-400">{origin}/c/</span>
        <input
          id="client-login-slug"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="your-business"
          className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <Button type="button" size="md" onClick={save} loading={saving} disabled={!dirty} className="shrink-0">
          Save
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-slate-400">Letters, numbers and hyphens — at least 3 characters.</p>
    </div>
  )
}
