'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Wallet } from 'lucide-react'
import { PackageForm, type PkgRow, type SessionFormOption } from '../package-form'
import { ConnectButton } from '../../settings/payments-actions'

/**
 * Page-mode wrapper around the shared PackageForm for creating a new package.
 * Mirrors EditPackageForm, with one extra beat: if the trainer just priced a
 * package and hasn't connected Stripe yet (and Connect is available to them),
 * we swap the form for a "connect Stripe to get paid" prompt rather than going
 * straight back to the list. Otherwise it returns to /packages and refreshes
 * server state so the list, FAB and onboarding wizard pick up the new package.
 */
export function NewPackageForm({
  sessionForms,
  promptConnect,
}: {
  sessionForms: SessionFormOption[]
  promptConnect: boolean
}) {
  const router = useRouter()
  const [created, setCreated] = useState<{ name: string } | null>(null)

  function backToList() {
    router.push('/packages')
    router.refresh()
  }

  function handleSaved(saved: PkgRow) {
    // Only nudge Stripe when the new package actually has a price to collect.
    if (promptConnect && saved.priceCents != null) {
      setCreated({ name: saved.name })
      return
    }
    backToList()
  }

  if (created) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--pm-brand-50)]">
          <Wallet className="h-6 w-6 text-[var(--pm-brand-600)]" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Package created 🎉</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-slate-500">
          “{created.name}” has a price. Connect your Stripe account so clients can
          pay for it right inside PupManager — secure card payments, paid straight
          to your bank.
        </p>
        <div className="mt-5 flex flex-col items-center gap-3">
          <ConnectButton label="Connect Stripe" />
          <button
            type="button"
            onClick={backToList}
            className="text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            Skip for now
          </button>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          You can always set this up later in Settings → Payments.
        </p>
      </div>
    )
  }

  return (
    <PackageForm
      existing={null}
      sessionForms={sessionForms}
      onCancel={() => router.push('/packages')}
      onSaved={handleSaved}
    />
  )
}
