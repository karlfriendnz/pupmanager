'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Ticket, Users, CalendarDays, MapPin, Repeat, Pencil, Copy } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import {
  OfferingCard, OfferingTabs, OfferingEmpty, OfferingTabEmpty, AddOfferingLink, OfferingPage,
  OfferingListBar, useOfferingView, OfferingItems, SortableOfferingList, SortableOfferingCard,   type OfferingFact,
} from '@/components/shared/offering-card'
import { useOfferingReorder } from '@/lib/use-offering-reorder'
import { formatMoney } from '@/lib/money'

export type RunRow = {
  id: string
  packageId: string
  name: string
  imageUrl: string | null
  description: string | null
  scheduleNote: string | null
  startLabel: string
  location: string | null
  capacity: number | null
  enrolled: number
  spacesLeft: number | null
  dropInPriceCents: number | null
  dropInCount: number
  slotSummary: string | null
  upcoming: { id: string; index: number | null; label: string }[]
  isPast: boolean
}

export function DropInsView({ runs: initialRuns, currency = 'NZD' }: { runs: RunRow[]; currency?: string }) {
  const [view, setView] = useOfferingView('casual-classes')

  const router = useRouter()
  const [tab, setTab] = useState<'current' | 'past'>('current')
  const [cloning, setCloning] = useState<string | null>(null)
  const { rows: runs, reorder, error: reorderError } = useOfferingReorder(initialRuns, 'classRun')

  const current = runs.filter(r => !r.isPast)
  const past = runs.filter(r => r.isPast)
  const shown = tab === 'past' ? past : current

  async function clone(packageId: string) {
    if (cloning) return
    setCloning(packageId)
    try {
      const res = await fetch(`/api/packages/${packageId}/clone`, { method: 'POST' })
      if (!res.ok) { alert('Could not duplicate that class.'); return }
      const created = await res.json() as { id: string }
      router.push(`/packages/${created.id}/edit`)
    } finally { setCloning(null) }
  }

  return (
    <>
      <PageHeader
        title="Casual Classes"
        subtitle="Classes people book one session at a time — set the day, time and per-session price, and they pick the week that suits."
      />
      <OfferingPage>
        {runs.length === 0 ? (
          <OfferingEmpty
            icon={<Ticket className="h-6 w-6" />}
            title="No casual classes yet"
            body="A casual class runs a set schedule that people can book one session at a time — set the day, time and per-session price."
            action={{ href: '/offerings/new?kind=dropin', label: 'New casual class' }}
          />
        ) : (
          <>
            {reorderError && (
              <p className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{reorderError}</p>
            )}
            <OfferingListBar view={view} onView={setView}>
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
                icon={<Ticket className="mx-auto h-10 w-10" />}
                title={tab === 'past' ? 'No past casual classes' : 'Nothing taking casual bookings'}
                body={tab === 'past'
                  ? 'Casual classes move here once their last session has been.'
                  : 'No classes are currently taking casual bookings. Set one up and clients can book a single session.'}
              />
            ) : (
              <SortableOfferingList ids={shown.map(r => r.id)} onReorder={reorder}>
                <OfferingItems view={view}>
                  {shown.map(r => (
                    <SortableOfferingCard key={r.id} id={r.id}>
                      {handle => (
                        <OfferingCard
                          href={`/casual-classes/${r.id}`}
                          title={r.name}
                          description={r.description}
                          imageUrl={r.imageUrl}
                          tile={{ icon: <Ticket className="h-5 w-5" />, className: 'bg-amber-50 text-amber-600' }}
                          dimmed={r.isPast}
                          dragHandle={handle}
                          badges={[
                            ...(r.dropInPriceCents != null
                              ? [{ label: `${formatMoney(r.dropInPriceCents, currency)} / session`, tone: 'warn' as const }]
                              : []),
                            ...(r.dropInCount > 0
                              ? [{ label: `${r.dropInCount} casual booking${r.dropInCount === 1 ? '' : 's'}`, tone: 'muted' as const }]
                              : []),
                          ]}
                          facts={dropInFacts(r)}
                          note={r.upcoming.length === 0 && !r.isPast
                            ? { label: 'No sessions left to drop into', tone: 'warn' }
                            : null}
                          actions={[
                            { icon: <Pencil className="h-4 w-4" />, label: 'Edit', onClick: () => router.push(`/packages/${r.packageId}/edit`) },
                            { icon: <Copy className="h-4 w-4" />, label: 'Duplicate', onClick: () => clone(r.packageId), disabled: cloning === r.packageId },
                          ]}
                        />
                      )}
                    </SortableOfferingCard>
                  ))}
                </OfferingItems>
              </SortableOfferingList>
            )}

            <AddOfferingLink href="/offerings/new?kind=dropin" label="New casual class" />
          </>
        )}
      </OfferingPage>
    </>
  )
}

function dropInFacts(r: RunRow): OfferingFact[] {
  const facts: OfferingFact[] = []

  // The schedule is the point of a drop-in class, so it leads.
  if (r.slotSummary) facts.push({ icon: <Repeat className="h-3.5 w-3.5" />, label: r.slotSummary })
  else if (r.scheduleNote) facts.push({ icon: <Repeat className="h-3.5 w-3.5" />, label: r.scheduleNote })

  facts.push({
    icon: <CalendarDays className="h-3.5 w-3.5" />,
    label: r.upcoming.length > 0 ? `Next ${r.upcoming[0].label}` : `Started ${r.startLabel}`,
  })

  if (r.location) facts.push({ icon: <MapPin className="h-3.5 w-3.5" />, label: r.location })

  facts.push({
    icon: <Users className="h-3.5 w-3.5" />,
    label: r.capacity == null
      ? `${r.enrolled} booked`
      : r.spacesLeft === 0
        ? `Full · ${r.enrolled} of ${r.capacity}`
        : `${r.spacesLeft} space${r.spacesLeft === 1 ? '' : 's'} · ${r.enrolled} of ${r.capacity}`,
    tone: r.spacesLeft === 0 ? 'bad' : r.spacesLeft != null && r.spacesLeft <= 2 ? 'warn' : 'good',
  })

  return facts
}
