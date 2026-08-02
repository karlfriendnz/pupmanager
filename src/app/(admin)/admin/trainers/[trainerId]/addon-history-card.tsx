import { formatDateTime } from '@/lib/utils'
import { listAddonChanges } from '@/lib/addon-change'
import { AlertTriangle, User, Shield, Server } from 'lucide-react'

// Who turned an add-on on or off, when, how, and whether it worked.
//
// Karl: "can you please also add some logging so we can see who and when people
// turn this on and off - including if you do it". The reason it matters is that
// a TrainerAddon row reading `active=false, updatedAt=30 July` cannot be told
// apart from a customer's own decision — which is why nobody could answer "why
// is Mersea Mutts' achievements off?" this morning. A failed attempt is on this
// list too, because a customer TRYING and being refused is the evidence that was
// missing.
//
// Rendered on the server (admin-only page, already authorized) straight off the
// append-only AuditLog. Nothing here can be edited.

const WHY: Record<string, string> = {
  webhook_sweep: 'Stripe no longer listed it on the subscription',
  subscription_missing: 'their subscription does not exist in Stripe',
  subscription_inactive: 'their subscription is not active',
  no_subscription: 'they have no subscription',
  stripe_unavailable: 'Stripe could not be reached',
  stripe_rejected: 'Stripe refused the change',
  price_lookup_failed: 'the price list could not be read',
  no_price: 'the add-on has no price in their currency',
  not_configured: 'billing is not configured',
  unknown_addon: 'the add-on is not sellable',
}

export async function AddonHistoryCard({ trainerId }: { trainerId: string }) {
  const entries = await listAddonChanges(trainerId, 40)

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Add-on history</h2>

      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">
          No add-on changes recorded for this business yet. Only changes made from today onwards
          appear here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-700/60">
          {entries.map(e => {
            const Icon = e.via === 'admin' ? Shield : e.via === 'system' ? Server : User
            return (
              <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                <Icon className="h-4 w-4 mt-0.5 shrink-0 text-slate-500" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-200">
                    {e.addonName}{' '}
                    {e.outcome === 'failed' ? (
                      <span className="text-rose-300">
                        could not be turned {e.active ? 'on' : 'off'}
                      </span>
                    ) : (
                      <span className={e.active ? 'text-emerald-300' : 'text-slate-400'}>
                        turned {e.active ? 'on' : 'off'}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {e.actorLabel}
                    {e.reason && WHY[e.reason] ? ` — ${WHY[e.reason]}` : ''}
                  </p>
                  {e.outcome === 'failed' && e.detail && (
                    <p className="text-[11px] text-slate-600 break-words">{e.detail}</p>
                  )}
                </div>
                <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                  {formatDateTime(e.at, 'Pacific/Auckland')}
                </span>
                {e.outcome === 'failed' && (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" strokeWidth={1.75} />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
