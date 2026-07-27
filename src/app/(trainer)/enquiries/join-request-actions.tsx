'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Loader2 } from 'lucide-react'

// One-tap approve for a dog owner who signed themselves up and asked to join.
//
// A form enquiry is a lead the trainer reads before deciding, so those still
// open to the detail screen. A join request is different: there is nothing to
// read — the person is either theirs or they are not — and burying a one-word
// decision behind a screen and a modal is how a waiting client sits unaccepted
// for a week. So the two actions sit on the row (AGENTS.md: actions belong on
// the page, not behind a "…").
//
// Both hit the SAME endpoints as the detail screen — /api/enquiries/[id]/accept
// runs acceptEnquiry -> findOrJoinClient. There is one approval mechanism.
export function JoinRequestActions({ enquiryId, name }: { enquiryId: string; name: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'accept' | 'decline'>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function run(kind: 'accept' | 'decline') {
    if (busy) return
    if (kind === 'decline' && !confirm(`Decline ${name}'s request to join? They won't be notified.`)) return
    setBusy(kind)
    setError(null)
    try {
      const res = await fetch(`/api/enquiries/${enquiryId}/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Accept takes an opt-in magic-link flag. A self-signup already set
        // their own password, so a login link would be noise.
        body: kind === 'accept' ? JSON.stringify({ sendMagicLink: false }) : undefined,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `Could not ${kind}`)
      startTransition(() => router.refresh())
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${kind}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => run('decline')}
          disabled={!!busy}
          aria-label={`Decline ${name}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[13px] font-medium text-slate-600 active:bg-slate-50 disabled:opacity-50"
        >
          {busy === 'decline' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" strokeWidth={1.75} />}
          Decline
        </button>
        <button
          type="button"
          onClick={() => run('accept')}
          disabled={!!busy}
          aria-label={`Add ${name} as a client`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-900 bg-slate-900 px-3 text-[13px] font-medium text-white active:bg-slate-800 disabled:opacity-50"
        >
          {busy === 'accept' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={1.75} />}
          Add client
        </button>
      </div>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
