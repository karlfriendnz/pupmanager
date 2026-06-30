'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, Loader2, AlertCircle } from 'lucide-react'

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
  const router = useRouter()
  const params = useSearchParams()
  const [busy, setBusy] = useState(false)

  // Surface the outcome of the OAuth round-trip (set by the callback redirect).
  const flag = params.get('xero')

  async function disconnect() {
    if (!confirm('Disconnect Xero? New invoices and payments will stop syncing.')) return
    setBusy(true)
    try {
      const res = await fetch('/api/xero/disconnect', { method: 'POST' })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/xero.svg" alt="Xero" className="h-10 w-10 flex-shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900">Xero accounting</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Sync invoices, payments and clients straight into your own Xero organisation.
          </p>

          {connected ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                <Check className="h-3.5 w-3.5" />
                Connected{orgName ? ` · ${orgName}` : ''}
              </span>
              <button
                type="button"
                onClick={disconnect}
                disabled={busy}
                className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline disabled:opacity-50"
              >
                {busy ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          ) : configured ? (
            <a
              href="/api/xero/connect"
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#13B5EA] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0f9fce]"
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

          {flag === 'connected' && (
            <p className="mt-2 text-xs text-emerald-600">Xero connected successfully.</p>
          )}
          {flag === 'error' && (
            <p className="mt-2 text-xs text-rose-600">Couldn’t connect to Xero. Please try again.</p>
          )}
          {flag === 'unconfigured' && (
            <p className="mt-2 text-xs text-rose-600">Xero isn’t configured for this environment yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}
