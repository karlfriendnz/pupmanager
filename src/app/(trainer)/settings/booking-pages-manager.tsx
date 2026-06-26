'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarClock, Copy, Check, ExternalLink, Plus, Trash2, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'

export type AutomationTrigger = 'ON_BOOKING' | 'BEFORE_SESSION' | 'AFTER_SESSION'

export interface AutomationRow {
  id: string
  trigger: AutomationTrigger
  offsetMinutes: number
  enabled: boolean
  subject: string
  body: string
}

export interface BookingPageRow {
  id: string
  name: string
  slug: string
  enabled: boolean
  headline: string | null
  intro: string | null
  slotLengthMins: number
  slotIntervalMins: number
  requiresApproval: boolean
  requiresPayment: boolean
  priceCents: number | null
  minNoticeHours: number
  windowDays: number
  availDays: number[]
  availStartTime: string | null
  availEndTime: string | null
  packageId: string | null
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  automations: AutomationRow[]
}

export interface PkgOption {
  id: string
  name: string
  durationMins: number
  sessionCount: number
}

// Booking-pages list. Each row links to its own edit page
// (/website/booking/<id>); creating one jumps straight into that editor.
export function BookingPagesManager({
  initialPages,
  slug,
  appUrl,
}: {
  initialPages: BookingPageRow[]
  slug: string | null
  appUrl: string
}) {
  const router = useRouter()
  const [pages, setPages] = useState<BookingPageRow[]>(initialPages)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const origin = appUrl.replace(/\/$/, '')

  async function createPage() {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/trainer/booking-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New booking page' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Could not create a page.')
        return
      }
      router.push(`/website/booking/${body.id}`)
    } finally {
      setCreating(false)
    }
  }

  async function deletePage(id: string) {
    if (!confirm('Delete this booking page? Any link to it will stop working.')) return
    const res = await fetch(`/api/trainer/booking-pages/${id}`, { method: 'DELETE' })
    if (res.ok) setPages(p => p.filter(x => x.id !== id))
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-slate-500" aria-hidden />
            <h3 className="text-sm font-semibold text-slate-900">Booking pages</h3>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Calendly-style pages where people pick an open time. New people become enquiries you accept; existing clients book themselves.
          </p>
        </div>
        <Button type="button" size="sm" onClick={createPage} loading={creating} className="shrink-0">
          <Plus className="h-4 w-4" /> New page
        </Button>
      </div>

      {!slug && (
        <Alert variant="info" className="mt-4">
          Set your public link slug on the Profile tab first — booking pages live at <code>/c/&lt;slug&gt;/book/…</code>.
        </Alert>
      )}
      {error && <Alert variant="error" className="mt-4">{error}</Alert>}

      {pages.length === 0 ? (
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-400">No booking pages yet — create one to share a “pick a time” link.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {pages.map(page => (
            <BookingPageRowItem
              key={page.id}
              page={page}
              fullUrl={slug ? `${origin}/c/${slug}/book/${page.slug}` : null}
              onDelete={() => deletePage(page.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BookingPageRowItem({
  page,
  fullUrl,
  onDelete,
}: {
  page: BookingPageRow
  fullUrl: string | null
  onDelete: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!fullUrl) return
    try {
      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* ignore */ }
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
      <Link href={`/website/booking/${page.id}`} className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-medium text-slate-900">{page.name}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${page.enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {page.enabled ? 'Live' : 'Off'}
        </span>
      </Link>
      {fullUrl && (
        <>
          <button onClick={copy} title="Copy link" className="inline-flex h-8 w-8 min-h-0 min-w-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
          <a href={fullUrl} target="_blank" rel="noopener noreferrer" title="Open" className="inline-flex h-8 w-8 min-h-0 min-w-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700">
            <ExternalLink className="h-4 w-4" />
          </a>
        </>
      )}
      <button onClick={onDelete} title="Delete" className="inline-flex h-8 w-8 min-h-0 min-w-0 items-center justify-center rounded-lg text-slate-400 hover:text-red-600">
        <Trash2 className="h-4 w-4" />
      </button>
      <Link href={`/website/booking/${page.id}`} title="Edit" className="inline-flex h-8 w-8 min-h-0 min-w-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700">
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  )
}
