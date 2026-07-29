'use client'

/**
 * The switchboard: everything included with the plan, on or off in one tap.
 *
 * These fifteen features used to live on the Add-ons page among the five you pay
 * for, each as a marketing card with a paragraph of sales copy — so turning on
 * something you already owned meant reading an advert to find it. This is the
 * other half of that split: no prices, no persuasion, one row per thing.
 *
 * ONE bordered block per group, hairline dividers inside, per the house style —
 * not fifteen floating cards.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, ExternalLink } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  FEATURE_GROUP_HINT, FEATURE_GROUP_LABEL,
  type ConfigurableFeature, type FeatureGroup,
} from '@/lib/configurable-features'

export interface ConfigureGroup {
  group: FeatureGroup
  features: ConfigurableFeature[]
}

/** Where a feature's own settings live, when it has some. The switch turns it on;
 *  this is where you then set it up, so the page doesn't dead-end. */
const SETUP_LINK: Partial<Record<string, { href: string; label: string }>> = {
  googlecalendar: { href: '/settings?tab=calendar', label: 'Connect a calendar' },
  xero: { href: '/settings?tab=xero', label: 'Connect Xero' },
  payments: { href: '/settings?tab=payments', label: 'Set up payments' },
  puppyschool: { href: '/settings?tab=daycare', label: 'Set up your daycare' },
  instagram: { href: '/instagram', label: 'Edit your link page' },
  library: { href: '/library', label: 'Open the library' },
  memberships: { href: '/memberships', label: 'Build a package' },
}

export function ConfigurePanel({
  groups,
  initialOn,
  canEdit,
}: {
  groups: ConfigureGroup[]
  /** Feature id → on/off, already resolved against each one's default. */
  initialOn: Record<string, boolean>
  canEdit: boolean
}) {
  const router = useRouter()
  const [on, setOn] = useState<Record<string, boolean>>(initialOn)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(id: string) {
    if (!canEdit || busy) return
    const next = !on[id]
    setError(null)
    setBusy(id)
    // Optimistic: the switch moves now, because waiting on a round trip to see a
    // toggle respond feels broken. Reverted below if the write fails.
    setOn(prev => ({ ...prev, [id]: next }))
    try {
      const res = await fetch('/api/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: id, active: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null
        setOn(prev => ({ ...prev, [id]: !next }))
        setError(body?.error ?? 'That did not save — try again.')
        return
      }
      // The nav, and every gated page, read this server-side.
      router.refresh()
    } catch {
      setOn(prev => ({ ...prev, [id]: !next }))
      setError('That did not save — try again.')
    } finally {
      setBusy(null)
    }
  }

  const total = groups.reduce((n, g) => n + g.features.length, 0)
  const activeCount = groups.reduce(
    (n, g) => n + g.features.filter(f => on[f.id]).length, 0,
  )

  return (
    <div className="max-w-3xl" data-review-scope="Tab: Configure">
      <p className="mb-4 text-sm text-slate-500 tabular-nums">
        {activeCount} of {total} turned on. All of these are included — nothing here costs extra.
      </p>

      {error && (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}
      {!canEdit && (
        <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          You can see what’s on, but only an owner or manager can change it.
        </p>
      )}

      <div className="flex flex-col gap-6">
        {groups.map(({ group, features }) => (
          <section key={group}>
            <h3 className="text-sm font-semibold text-slate-900">{FEATURE_GROUP_LABEL[group]}</h3>
            <p className="mt-0.5 mb-2 text-xs text-slate-500">{FEATURE_GROUP_HINT[group]}</p>

            <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              {features.map(f => {
                const setup = SETUP_LINK[f.id]
                const isOn = !!on[f.id]
                return (
                  <div key={f.id} className="flex items-start gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-sm font-semibold text-slate-900">{f.name}</span>
                        {f.badge && (
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            {f.badge}
                          </span>
                        )}
                        {f.hidden && (
                          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                            Unfinished
                          </span>
                        )}
                      </div>
                      {/* One line. The full pitch lives on the Add-ons page; here
                          you already own it and just need to know what it is. */}
                      <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{f.description}</p>
                      {isOn && setup && (
                        <Link
                          href={setup.href}
                          className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900"
                        >
                          {setup.label} <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                        </Link>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pt-0.5">
                      {busy === f.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" strokeWidth={1.75} />}
                      <Switch
                        checked={isOn}
                        onChange={() => void toggle(f.id)}
                        disabled={!canEdit || busy !== null}
                        onColor="bg-teal-600"
                        aria-label={`${f.name} — ${isOn ? 'on' : 'off'}`}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {/* The other half of the split, named so the two pages explain each other. */}
      <p className="mt-6 text-sm text-slate-500">
        Looking for something that isn’t here?{' '}
        <Link href="/settings?tab=addons" className="font-semibold text-teal-700 hover:text-teal-900">
          Add-ons
        </Link>{' '}
        has the paid extras.
      </p>
    </div>
  )
}
