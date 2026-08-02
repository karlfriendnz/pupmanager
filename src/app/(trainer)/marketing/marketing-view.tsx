'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Mail, Megaphone, CheckCircle2, Settings2, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddOfferingButton, OfferingListBar } from '@/components/shared/offering-card'
import { SendingDomainPanel } from './sending-domain-panel'

interface BroadcastRow {
  id: string
  subject: string
  recipientCount: number
  createdAt: string
  delivered: number
  opened: number
  clicked: number
}

interface Props {
  businessName: string
  domainVerified: boolean
  trialDomain: boolean
  sendingFromEmail: string | null
  canSend: boolean
  eligibleCount: number
  broadcasts: BroadcastRow[]
  /** Send summary surfaced after returning from /marketing/new (via ?sent=). */
  initialFlash?: string | null
}

export function MarketingView({ domainVerified, trialDomain, sendingFromEmail, canSend, eligibleCount, broadcasts, initialFlash }: Props) {
  const router = useRouter()
  const [flash] = useState<string | null>(initialFlash ?? null)
  const [showDomainSetup, setShowDomainSetup] = useState(false)

  // Ready to send via either the verified own domain OR the PupManager test sender.
  const sendingReady = domainVerified || trialDomain
  const canCompose = canSend && sendingReady && eligibleCount > 0

  return (
    <>
      {flash && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {flash}
        </div>
      )}

      {/* The one action this screen has, as a real button at the top beside
          nothing else — the same place "New tag" and "New achievement" sit. It
          used to be buried on the right of a card two thirds of the way down,
          which is where a trainer with forty sent emails had to go looking for
          the only thing they came here to do.

          It stays visible on a phone: the create circle in the corner makes
          offerings, clients and sales, and a campaign is none of them.

          Disabled rather than hidden when it can't be pressed, because the
          reason is worth saying — no permission, no mailable clients, or no
          sending address yet, which the panel underneath then walks through. */}
      <OfferingListBar
        action={canCompose ? (
          <AddOfferingButton href="/marketing/new" label="New email" />
        ) : (
          <Button
            type="button"
            disabled
            title={
              !canSend ? 'You do not have permission to send messages'
                : !sendingReady ? 'Set up a sending address first'
                : 'No clients can be emailed yet'
            }
          >
            <Mail className="h-4 w-4" />
            New email
          </Button>
        )}
      />

      {/* Sending-domain setup. Not verified → the setup panel, because nothing
          else on this screen can happen until it is. Verified → one quiet line
          saying who can be reached and from what address, with the settings
          folded away behind a link.

          It was a card with a brand-tinted tile behind a mail icon, which the
          house style has no room for and which made the loudest thing on the
          page a status the trainer reads once. */}
      {!sendingReady ? (
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Set up email sending</h2>
          <p className="mb-4 text-sm text-slate-600">
            Before you can email your clients, verify a sending domain so mail comes from your own address — better
            deliverability and your branding. Or use the PupManager test domain to try it right away.
          </p>
          <SendingDomainPanel onChange={() => router.refresh()} />
        </div>
      ) : (
        <div className="mb-6">
          <p className="text-sm text-slate-600">
            {eligibleCount} active {eligibleCount === 1 ? 'client' : 'clients'} can be emailed
            {domainVerified && sendingFromEmail
              ? <> from <span className="font-medium text-slate-700">{sendingFromEmail}</span></>
              : <> from your <span className="font-medium text-slate-700">PupManager test address</span></>}.
            {' '}Want to email just some of them? Select them on the{' '}
            <Link href="/clients" className="underline hover:no-underline">Clients</Link> page.
          </p>
          {canSend && eligibleCount === 0 && (
            <p className="mt-1 text-xs text-slate-400">
              No active clients with an email address yet. Add clients, or check who&rsquo;s opted out.
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowDomainSetup(o => !o)}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            <Settings2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            {showDomainSetup
              ? 'Hide sending domain settings'
              : domainVerified ? 'Manage sending domain' : 'Set up your own domain'}
          </button>
          {showDomainSetup && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <SendingDomainPanel onChange={() => router.refresh()} />
            </div>
          )}
        </div>
      )}

      {/* Past broadcasts */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Sent emails</h2>
      {broadcasts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400">
          <Megaphone className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">No emails sent yet. Your campaigns will show here with open and click stats.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="hidden sm:grid grid-cols-[1fr_64px_64px_64px_20px] gap-3 px-4 py-2.5 border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <span>Campaign</span>
            <span className="text-right">Sent</span>
            <span className="text-right">Opened</span>
            <span className="text-right">Clicked</span>
            <span />
          </div>
          {broadcasts.map(b => (
            <Link
              key={b.id}
              href={`/marketing/${b.id}`}
              className="grid grid-cols-[1fr_64px_64px_64px_20px] items-center gap-3 px-4 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{b.subject}</p>
                <p className="text-xs text-slate-400">
                  {new Date(b.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
              {/* Three plain figures. Opened was blue and Clicked was green,
                  which is colour doing a job the column headings already do —
                  and the only colour on a screen that otherwise has none. */}
              <span className="text-right text-sm font-semibold tabular-nums text-slate-700">{b.recipientCount}</span>
              <span className="text-right text-sm font-semibold tabular-nums text-slate-700">{b.opened}</span>
              <span className="text-right text-sm font-semibold tabular-nums text-slate-700">{b.clicked}</span>
              <ChevronRight className="h-4 w-4 text-slate-300 justify-self-end" />
            </Link>
          ))}
        </div>
      )}

    </>
  )
}

