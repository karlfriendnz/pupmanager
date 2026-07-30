import type { Metadata } from 'next'
import Link from 'next/link'

import { reconcileBilling, type Finding } from '@/lib/billing-reconcile'
import { isStripeConfigured } from '@/lib/stripe'

export const metadata: Metadata = { title: 'Billing health' }
// Always fresh: a cached answer to "is anyone being charged twice" is worse
// than no answer, because it looks current.
export const dynamic = 'force-dynamic'

/**
 * Does Stripe agree with what we think we are billing?
 *
 * The same checks the daily cron runs (lib/billing-reconcile), on demand and
 * on a screen. That matters for two reasons: the cron cannot run until
 * CRON_SECRET is rotated, and the live Stripe key is marked Sensitive in Vercel
 * so it cannot be read back for a local script. This page needs neither — it
 * runs server-side where the key already is.
 *
 * Read-only. Which half of a duplicated pair to keep depends on what each has
 * already charged, so it reports and links to Stripe rather than acting.
 */

const TONE: Record<Finding['kind'], { chip: string; label: string }> = {
  DUPLICATE: { chip: 'bg-red-900 text-red-200', label: 'Charged twice' },
  ORPHAN: { chip: 'bg-orange-900 text-orange-200', label: 'Not ours' },
  MISMATCH: { chip: 'bg-amber-900 text-amber-200', label: 'Out of step' },
}

export default async function BillingHealthPage() {
  if (!isStripeConfigured(false)) {
    return (
      <div className="p-6 text-slate-300">
        <h1 className="text-xl font-bold text-white mb-2">Billing health</h1>
        <p>Stripe isn&rsquo;t configured in this environment, so there&rsquo;s nothing to compare against.</p>
      </div>
    )
  }

  let result: Awaited<ReturnType<typeof reconcileBilling>> | null = null
  let error: string | null = null
  try {
    result = await reconcileBilling()
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Billing health</h1>
        <p className="text-sm text-slate-400 mt-1">
          What Stripe is actually charging, against what we think we&rsquo;re charging. Read-only.
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-950 border border-red-900 p-4 text-red-200 text-sm">
          <p className="font-semibold mb-1">Couldn&rsquo;t reach Stripe</p>
          <p className="font-mono text-xs">{error}</p>
        </div>
      )}

      {result && (
        <>
          <div className="flex flex-wrap gap-3">
            <Stat label="Customers billing" value={result.customersWithLiveSubscriptions} />
            <Stat label="Trainers checked" value={result.trainersChecked} />
            <Stat
              label="Being charged twice"
              value={result.duplicates}
              bad={result.duplicates > 0}
            />
          </div>

          {result.findings.length === 0 ? (
            <div className="rounded-xl bg-emerald-950 border border-emerald-900 p-5 text-emerald-200">
              <p className="font-semibold">Stripe and PupManager agree.</p>
              <p className="text-sm text-emerald-300/80 mt-1">
                Nobody is double-subscribed, every live subscription belongs to a trainer we know about,
                and every trainer points at a subscription Stripe still has.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-slate-400">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">What</th>
                    <th className="text-left font-medium px-4 py-2">Who</th>
                    <th className="text-left font-medium px-4 py-2">Detail</th>
                    <th className="text-left font-medium px-4 py-2">Stripe</th>
                  </tr>
                </thead>
                <tbody>
                  {result.findings.map((f, i) => (
                    <tr key={`${f.customerId}-${i}`} className="border-t border-slate-800 align-top">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${TONE[f.kind].chip}`}>
                          {TONE[f.kind].label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white">{f.who}</td>
                      <td className="px-4 py-3 text-slate-300">{f.detail}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`https://dashboard.stripe.com/customers/${f.customerId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-teal-400 hover:underline whitespace-nowrap"
                        >
                          Open customer →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.duplicates > 0 && (
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 text-sm text-slate-300">
              <p className="font-semibold text-white mb-1">Fixing a duplicate</p>
              <p>
                Cancel the one they don&rsquo;t want in Stripe and refund what it took — check what each has
                already charged first, since they can carry different add-ons. Cancelling is safe: the webhook
                moves the trainer onto the surviving subscription rather than marking them cancelled.
              </p>
            </div>
          )}

          <p className="text-xs text-slate-500">
            Checked {new Date(result.checkedAt).toLocaleString('en-NZ')}. Reload to run it again.
          </p>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, bad = false }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 min-w-[9rem] ${bad ? 'bg-red-950 border-red-900' : 'bg-slate-900 border-slate-800'}`}>
      <div className={`text-2xl font-bold ${bad ? 'text-red-200' : 'text-white'}`}>{value}</div>
      <div className={`text-xs ${bad ? 'text-red-300/80' : 'text-slate-400'}`}>{label}</div>
    </div>
  )
}
