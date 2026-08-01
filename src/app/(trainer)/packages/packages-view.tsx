'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Package as PackageIcon,
  Repeat, Clock, Video, MapPin, Users, Route,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { ConnectPaymentsModal } from '../settings/connect-payments-prompt'
import { type PackageColor, type PkgRow } from './package-form'
import { formatMoney } from '@/lib/money'
import {
  OfferingCard, OfferingTabs, OfferingEmpty, OfferingTabEmpty, AddOfferingButton, OfferingPage,
  OfferingListBar, useOfferingView, OfferingItems, SortableOfferingList, SortableOfferingCard,   type OfferingFact, type OfferingBadge,
} from '@/components/shared/offering-card'
import { useOfferingReorder } from '@/lib/use-offering-reorder'

export type { SessionFormOption } from './package-form'

/** A package plus whether it's finished — see ./past-packages for the rule. */
export type PackageListRow = PkgRow & { isPast: boolean }

// Static class map — Tailwind purges dynamic class names so each package
// colour needs its own listed pair here.
const PACKAGE_ICON_CLASSES: Record<PackageColor, string> = {
  blue:    'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber:   'bg-amber-50 text-amber-600',
  rose:    'bg-rose-50 text-rose-600',
  purple:  'bg-purple-50 text-purple-600',
  orange:  'bg-orange-50 text-orange-600',
  teal:    'bg-teal-50 text-teal-600',
  indigo:  'bg-indigo-50 text-indigo-600',
  pink:    'bg-pink-50 text-pink-600',
  cyan:    'bg-cyan-50 text-cyan-600',
}
function packageIconClasses(color: PackageColor | null): string {
  return color ? PACKAGE_ICON_CLASSES[color] : 'bg-blue-50 text-blue-600'
}

export function PackagesView({
  initialPackages,
  connectName = null,
  currency = 'NZD',
}: {
  initialPackages: PackageListRow[]
  // Set (to the new package's name) when we've just created a priced package
  // and want to pop the connect-Stripe modal over the list.
  connectName?: string | null
  currency?: string
}) {
  const [view, setView] = useOfferingView('packages')

  const router = useRouter()
  const [tab, setTab] = useState<'current' | 'past'>('current')
  // Same drag + saved order as every other offering list.
  const { rows: packages, reorder, error: reorderError } = useOfferingReorder(initialPackages, 'package')

  // Left in the trainer's own arranged order — that's what the drag handle
  // writes and what clients see. See ./past-packages for what "past" means.
  const current = packages.filter(p => !p.isPast)
  const past = packages.filter(p => p.isPast)
  const shown = tab === 'past' ? past : current

  return (
    <>
      <PageHeader
        title="1:1 Sessions"
        subtitle="Bundles of 1:1 sessions you assign to a client in one go — set the count, spacing and price once."
      />
      <OfferingPage>
        {packages.length === 0 ? (
          <OfferingEmpty
            icon={<PackageIcon className="h-6 w-6" />}
            title="No 1:1 sessions yet"
            body="A 1:1 session is a bundle of 1:1 sessions you assign to a client in one go — set the count, spacing and price once, then reuse it."
            action={{ href: '/offerings/new?kind=onetoone', label: 'New 1:1 session' }}
          />
        ) : (
          <>
            {reorderError && (
              <p className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{reorderError}</p>
            )}
            <OfferingListBar
              view={view}
              onView={setView}
              action={<AddOfferingButton href="/offerings/new?kind=onetoone" label="New 1:1 session" />}
            >
              <OfferingTabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: 'current', label: 'Current', count: current.length },
                  { id: 'past', label: 'Past', count: past.length },
                ]}
              />
            </OfferingListBar>

            {shown.length === 0 ? (
              <OfferingTabEmpty
                icon={<PackageIcon className="mx-auto h-10 w-10" />}
                title={tab === 'past' ? 'No past 1:1 sessions' : 'No current 1:1 sessions'}
                body={tab === 'past'
                  ? 'A 1:1 session moves here once everyone you assigned it to has had their last session. It stays put while anyone still has one to come.'
                  : 'Every 1:1 session you have has run its course. Make a new one, or duplicate one from Past to start it again.'}
              />
            ) : (
              <SortableOfferingList ids={shown.map(p => p.id)} onReorder={reorder}>
                <OfferingItems view={view}>
                  {shown.map(p => (
                    <SortableOfferingCard key={p.id} id={p.id}>
                      {handle => (
                        <OfferingCard
                          href={`/packages/${p.id}`}
                          title={p.name}
                          description={p.description}
                          imageUrl={p.imageUrl}
                          tile={{ icon: <PackageIcon className="h-5 w-5" />, className: packageIconClasses(p.color) }}
                          badges={packageBadges(p, currency)}
                          facts={packageFacts(p)}
                          dimmed={p.isPast}
                          dragHandle={handle}
                          /* No row actions. Three icons on every card is a lot
                             of chrome on a list you mostly read, and the card
                             already opens the offering — where OfferingActions
                             carries Edit, Duplicate and Delete. Nothing is lost,
                             it just takes one click to get to. */
                        />
                      )}
                    </SortableOfferingCard>
                  ))}
                </OfferingItems>
              </SortableOfferingList>
            )}
          </>
        )}
      </OfferingPage>

      {connectName && (
        <ConnectPaymentsModal onClose={() => router.replace('/packages')} currency={currency} />
      )}
    </>
  )
}

// Drag handle only appears when there's more than one package (nothing to
// reorder when there's one).
function packageBadges(p: PkgRow, currency: string): OfferingBadge[] {
  const badges: OfferingBadge[] = []
  // A special price shows beside the old one, struck, so it reads as "was".
  if (p.specialPriceCents != null && p.priceCents != null) {
    badges.push({ label: formatMoney(p.specialPriceCents, currency), tone: 'good' })
    badges.push({ label: formatMoney(p.priceCents, currency), tone: 'muted', strike: true })
  } else if (p.priceCents != null) {
    badges.push({ label: formatMoney(p.priceCents, currency), tone: 'accent' })
  }
  return badges
}

function packageFacts(p: PkgRow): OfferingFact[] {
  const facts: OfferingFact[] = [
    {
      icon: <Repeat className="h-3.5 w-3.5" />,
      label: p.sessionCount === 0
        ? 'Ongoing'
        : `${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}${p.weeksBetween > 0 ? `, every ${p.weeksBetween} week${p.weeksBetween > 1 ? 's' : ''}` : ''}`,
    },
    { icon: <Clock className="h-3.5 w-3.5" />, label: `${p.durationMins} min` },
    p.sessionType === 'VIRTUAL'
      ? { icon: <Video className="h-3.5 w-3.5" />, label: 'Virtual' }
      : { icon: <MapPin className="h-3.5 w-3.5" />, label: 'In person' },
  ]
  // A curriculum is the thing that makes this a SERIES rather than a bundle of
  // sessions, so it reads on the card beside the session count.
  if (p.seriesSteps && p.seriesSteps > 0) {
    facts.push({
      icon: <Route className="h-3.5 w-3.5" />,
      label: `${p.seriesSteps} step${p.seriesSteps === 1 ? '' : 's'}`,
    })
  }
  if (p.assignments > 0) {
    facts.push({
      icon: <Users className="h-3.5 w-3.5" />,
      label: `${p.assignments} assigned`,
      tone: 'good',
    })
  }
  return facts
}
