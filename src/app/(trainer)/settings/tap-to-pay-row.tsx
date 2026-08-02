'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight, Check, Loader2, Nfc } from 'lucide-react'
import { openExternal } from '@/lib/external-link'
import type { TapToPayEligibility } from '@/lib/use-tap-to-pay'

// Settings → Payments → "Take cards on your phone".
//
// This row exists for one reason: APPLE MAKES EVERY MERCHANT ACCEPT ITS TERMS
// INDIVIDUALLY, with a real Apple ID, before their first tap. With Connect
// direct charges that acceptance is per connected account, so PupManager
// accepting as a platform does nothing for the trainer. It is unavoidable
// paperwork; the least we can do is make it one tap from a screen they are
// already on, at a desk, rather than a support ticket or — far worse — Apple's
// terms sheet appearing over the top of a trainer who is mid-sale with a
// customer waiting.
//
// It is deliberately NOT hidden when Tap to Pay is unavailable. A trainer in
// South Africa, or on an iPad, gets told plainly and once. A row that silently
// isn't there is a question nobody can ask.
//
// Client component because the answer depends on the DEVICE this is being read
// on, which the server rendering the page cannot know.

export function TapToPayRow() {
  const [state, setState] = useState<TapToPayEligibility | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/terminal/eligibility')
        const data = (await res.json()) as TapToPayEligibility
        if (!cancelled) setState(res.ok ? data : null)
      } catch {
        if (!cancelled) setState(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function acceptTerms() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/terminal/onboarding-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = (await res.json().catch(() => null)) as { url?: string } | null
      if (!res.ok || !data?.url) {
        setError('Couldn’t open Apple’s terms just now. Try again in a minute.')
        return
      }
      // Apple's page needs a real browser and a real Apple ID sign-in, so it
      // goes OUT of the app — inside the WebView the sign-in would fail and
      // there would be no way back. openExternal handles native vs web.
      openExternal(data.url)
    } finally {
      setBusy(false)
    }
  }

  // Nothing at all until we know — a row that appears and then changes its mind
  // about whether a trainer can take cards is worse than a beat of silence.
  if (loading || !state) return null

  const accepted = state.terms.accepted

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
      <div className="max-w-md">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
          <Nfc className="h-4 w-4 text-slate-400" strokeWidth={1.75} />
          Take cards on your phone
        </p>
        <p className="text-xs text-slate-500">{explain(state)}</p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>

      {!state.eligible ? null : accepted ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Check className="h-4 w-4" strokeWidth={1.75} />
          Ready
        </span>
      ) : (
        <button
          type="button"
          onClick={acceptTerms}
          disabled={busy}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />}
          {state.terms.linked ? 'Open Apple’s terms again' : 'Accept Apple’s terms'}
          <ArrowUpRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
    </div>
  )
}

/**
 * One sentence, written for the trainer reading it.
 *
 * The unavailable cases each say WHY and, where it is permanent, say that too.
 * A South African trainer is never going to get this and should be told so
 * once, in plain words, rather than left wondering what they've configured
 * wrong.
 */
function explain(state: TapToPayEligibility): string {
  if (state.reason === 'COUNTRY_UNSUPPORTED') {
    return 'Stripe doesn’t do in-person card payments in your country, so this isn’t available to you.'
  }
  if (state.reason === 'ADDON_REQUIRED') {
    return 'Turn on the Instant sale add-on and you can take cards straight on your phone.'
  }
  if (state.reason === 'PAYMENTS_REQUIRED') {
    return 'Finish setting up payments above, and you’ll be able to take cards on your phone.'
  }
  if (state.terms.accepted) {
    return `Clients can tap a card, phone or watch on your iPhone to pay${
      state.merchantName ? ` ${state.merchantName}` : ''
    }. Needs an iPhone XS or newer — iPads have no card reader.`
  }
  return 'Apple asks every business to accept its terms before taking cards this way. It takes a minute, with your Apple ID, and you only do it once.'
}
