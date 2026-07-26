'use client'

import { useState, type MouseEvent } from 'react'
import { ArrowUpRight, Loader2 } from 'lucide-react'
import { useIsNative } from '@/lib/native'
import { openExternal } from '@/lib/external-link'

const HREF = '/api/connect/login-link'

// "Open Stripe dashboard" — payouts, balance and KYC, which Stripe owns for
// Express accounts.
//
// WEB: a new tab (target="_blank"). Settings is still sitting there when the
// trainer comes back from Stripe. The href is our own route — it mints a
// single-use login link and redirects — so the new tab carries the session
// cookie and the redirect lands on Stripe.
//
// NATIVE: `target="_blank"` under Capacitor hands the URL to the OS browser,
// which has NO app session (the same trap the "View as client" preview link
// avoids by staying in the WebView). Here the DESTINATION is genuinely
// external and should leave the app — nobody wants a banking/KYC flow trapped
// in a chrome-less WebView — but the href isn't: the OS browser would hit
// /api/connect/login-link cookie-less and get bounced to the login screen.
// So on native we resolve the link in the WebView first (?json=1, session
// intact) and hand the real https://connect.stripe.com/… URL to the OS via
// openExternal. If iOS has the Stripe app and claims that host as a universal
// link it opens there instead — the OS decides that, not us.
export function StripeDashboardLink() {
  const native = useIsNative()
  const [busy, setBusy] = useState(false)

  async function openNatively(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`${HREF}?json=1`)
      const data = (await res.json().catch(() => null)) as { url?: string } | null
      if (res.ok && data?.url) openExternal(data.url)
      // Couldn't resolve it — fall back to the plain redirect in the WebView,
      // which at least gets the trainer somewhere useful (Stripe, or back to
      // settings with an error).
      else window.location.assign(HREF)
    } finally {
      setBusy(false)
    }
  }

  return (
    <a
      href={HREF}
      target={native ? undefined : '_blank'}
      rel={native ? undefined : 'noopener noreferrer'}
      onClick={native ? openNatively : undefined}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />}
      Open Stripe dashboard
      <ArrowUpRight className="h-4 w-4" strokeWidth={1.75} />
    </a>
  )
}
