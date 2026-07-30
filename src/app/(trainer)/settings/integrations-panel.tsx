'use client'

/**
 * The integrations board: one card per outside service, Manage to set it up.
 *
 * Wears the Add-ons grid's clothes on purpose (Karl liked that layout, 2026-07-30)
 * — same card shape, same teal header, same "Manage →" affordance — so the two
 * screens read as siblings rather than as two different designers' work.
 *
 * What it adds over Add-ons is STATE. An add-on is on or off; an integration can
 * be switched on and still not connected, and that middle state is the one that
 * used to cost a support conversation.
 */

import Link from 'next/link'
import { Check, AlertCircle, Circle } from 'lucide-react'
import { stateLabel, type IntegrationState } from '@/lib/integrations'

export interface IntegrationCard {
  id: string
  name: string
  blurb: string
  manageHref: string
  state: IntegrationState
}

function StateBadge({ state }: { state: IntegrationState }) {
  // Semantic, not decorative: these three say "working", "needs you" and
  // "nothing here yet", which is the one thing a trainer scans this page for.
  const look =
    state === 'connected' ? { Icon: Check, cls: 'text-emerald-700' }
    : state === 'needs_setup' ? { Icon: AlertCircle, cls: 'text-amber-700' }
    : { Icon: Circle, cls: 'text-slate-400' }
  const { Icon, cls } = look
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${cls}`}>
      <Icon className="h-4 w-4" strokeWidth={2} />
      {stateLabel(state)}
    </span>
  )
}

export function IntegrationsPanel({ cards }: { cards: IntegrationCard[] }) {
  const live = cards.filter(c => c.state === 'connected').length
  const waiting = cards.filter(c => c.state === 'needs_setup')

  return (
    <div className="max-w-5xl" data-review-scope="Tab: Integrations">
      <p className="mb-4 text-sm text-slate-500 tabular-nums">
        {live} of {cards.length} connected.
      </p>

      {/* The middle state, said once at the top. Being switched on but not
          connected is silent otherwise — the app looks fine and simply doesn't
          sync. */}
      {waiting.length > 0 && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" strokeWidth={2} />
          <span>
            {waiting.length === 1
              ? <>{waiting[0].name} is switched on but isn’t connected yet, so it isn’t doing anything.</>
              : <>{waiting.length} are switched on but aren’t connected yet, so they aren’t doing anything.</>}
          </span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(card => (
          <Link
            key={card.id}
            href={card.manageHref}
            className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-shadow hover:shadow-md"
          >
            <div
              className="relative flex h-24 items-center px-4 text-white"
              style={{ backgroundImage: 'linear-gradient(135deg, #2A9DA9, #1F818C)' }}
            >
              <h3 className="text-[15px] font-bold leading-tight">{card.name}</h3>
            </div>

            <div className="flex flex-1 flex-col p-4">
              <p className="mb-3 text-sm leading-snug text-slate-600">{card.blurb}</p>
              <div className="mt-auto flex items-center justify-between gap-2">
                <StateBadge state={card.state} />
                <span className="text-[13px] font-medium text-teal-700 group-hover:underline">
                  {card.state === 'off' ? 'Set up' : 'Manage'} →
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
