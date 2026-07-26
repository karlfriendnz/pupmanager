'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, Loader2, AlertCircle } from 'lucide-react'
import { XeroMappingPanel } from './xero-mapping-panel'

// Settings → Integrations card for the Xero accounting connection. Shows the
// connected org (or a connect CTA) and lets an owner disconnect. The actual
// invoice/payment syncing is layered on in later phases; this is the on/off.
export function XeroConnectionCard({
  connected,
  orgName,
  configured,
}: {
  connected: boolean
  orgName: string | null
  configured: boolean
}) {
  const params = useSearchParams()
  const [busy, setBusy] = useState(false)

  // Surface the outcome of the OAuth round-trip (set by the callback redirect).
  const flag = params.get('xero')

  async function disconnect() {
    if (!confirm('Disconnect Xero? New invoices and payments will stop syncing.')) return
    setBusy(true)
    try {
      const res = await fetch('/api/xero/disconnect', { method: 'POST' })
      // Full navigation (not router.refresh) so the server re-reads the now-gone
      // connection AND the stale ?xero=connected success flag is cleared.
      if (res.ok) { window.location.assign('/settings?tab=xero'); return }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      {/* Xero logo will sit here, top-right. */}
      <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">Xero accounting</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Sync invoices, payments and clients straight into your own Xero organisation.
          </p>

          {connected ? (
            // Status reads as a plain line, not a tinted chip: on a phone the
            // org name is long enough to need the whole width.
            <div className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-3">
              <Check className="h-[18px] w-[18px] shrink-0 text-slate-700" strokeWidth={1.75} />
              <p className="min-w-0 flex-1 text-sm text-slate-700">
                Connected{orgName ? <> · <span className="font-medium text-slate-900">{orgName}</span></> : ''}
              </p>
              <button
                type="button"
                onClick={disconnect}
                disabled={busy}
                className="-my-2 shrink-0 py-2 text-sm font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline disabled:opacity-50"
              >
                {busy ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          ) : configured ? (
            <a
              href="/api/xero/connect"
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#13B5EA] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0f9fce] sm:w-auto"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Connect Xero
            </a>
          ) : (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
              <AlertCircle className="h-3.5 w-3.5" />
              Xero isn’t configured for this environment yet.
            </p>
          )}

          {flag === 'error' && (
            <p className="mt-2 text-xs text-rose-600">Couldn’t connect to Xero. Please try again.</p>
          )}
          {flag === 'unconfigured' && (
            <p className="mt-2 text-xs text-rose-600">Xero isn’t configured for this environment yet.</p>
          )}

          {connected && <XeroMappingPanel />}
      </div>
    </div>
  )
}
