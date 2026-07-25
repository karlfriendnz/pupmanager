'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarPlus, MapPin, Users, Ticket, Pencil, Copy, CalendarDays } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import {
  OfferingCard, OfferingTabs, OfferingEmpty, OfferingTabEmpty, AddOfferingLink, OfferingPage,
  OfferingListBar, useOfferingView, OfferingItems, SortableOfferingList, SortableOfferingCard,   type OfferingFact,
} from '@/components/shared/offering-card'
import { useOfferingReorder } from '@/lib/use-offering-reorder'
import { formatMoney } from '@/lib/money'

export type EventTier = { id: string; name: string; priceCents: number | null; capacity: number | null }

export type EventRow = {
  id: string
  packageId: string
  name: string
  description: string | null
  whenLabel: string
  location: string | null
  imageUrl: string | null
  status: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
  capacity: number | null
  booked: number
  priceCents: number | null
  durationMins: number
  tiers: EventTier[]
  isPast: boolean
}

export function EventsView({ events: initialEvents, currency }: { events: EventRow[]; currency: string }) {
  const [view, setView] = useOfferingView('events')

  const router = useRouter()
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const [cloning, setCloning] = useState<string | null>(null)
  const { rows: events, reorder, error: reorderError } = useOfferingReorder(initialEvents, 'classRun')

  // Left in the trainer's own arranged order (ties fall back to date) — that's
  // what the drag handle writes and what clients see.
  const upcoming = events.filter(e => !e.isPast)
  const past = events.filter(e => e.isPast)
  const shown = tab === 'past' ? past : upcoming

  async function clone(packageId: string) {
    if (cloning) return
    setCloning(packageId)
    try {
      const res = await fetch(`/api/packages/${packageId}/clone`, { method: 'POST' })
      if (!res.ok) { alert('Could not duplicate that event.'); return }
      const created = await res.json() as { id: string }
      router.push(`/packages/${created.id}/edit`)
    } finally { setCloning(null) }
  }

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="One-off events clients sign up to — workshops, seminars and meet-ups, with tickets, capacity and a guest list."
      />
      <OfferingPage>
        {events.length === 0 ? (
          <OfferingEmpty
            icon={<CalendarPlus className="h-6 w-6" />}
            title="No events yet"
            body="Set up a one-off event on a single date — pick the time, add ticket types and a capacity, and share the sign-up with your clients."
            action={{ href: '/offerings/new?kind=oneoff', label: 'New event' }}
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
                  { id: 'upcoming', label: 'Upcoming', count: upcoming.length },
                  { id: 'past', label: 'Past', count: past.length },
                ]}
              />
            </OfferingListBar>

            {shown.length === 0 ? (
              <OfferingTabEmpty
                icon={<CalendarPlus className="h-10 w-10" />}
                title={tab === 'past' ? 'No past events' : 'Nothing coming up'}
                body={tab === 'past'
                  ? 'Events move here once their date has been, or when you mark them complete or cancelled.'
                  : 'Every event you have has been. Put another one in the diary.'}
              />
            ) : (
              <SortableOfferingList ids={shown.map(e => e.id)} onReorder={reorder}>
                <OfferingItems view={view}>
                  {shown.map(e => (
                    <SortableOfferingCard key={e.id} id={e.id}>
                      {handle => (
                        <OfferingCard
                          href={`/classes/${e.id}`}
                          title={e.name}
                          description={e.description}
                          imageUrl={e.imageUrl}
                          tile={{ icon: <CalendarPlus className="h-5 w-5" />, className: 'bg-violet-50 text-violet-600' }}
                          dimmed={e.isPast}
                          dragHandle={handle}
                          badges={[
                            ...(e.status === 'CANCELLED' ? [{ label: 'Cancelled', tone: 'bad' as const }] : []),
                            ...(ticketLabel(e, currency) ? [{ label: ticketLabel(e, currency)!, tone: 'accent' as const }] : []),
                          ]}
                          facts={eventFacts(e, currency)}
                          actions={[
                            { icon: <Pencil className="h-4 w-4" />, label: 'Edit', onClick: () => router.push(`/packages/${e.packageId}/edit`) },
                            { icon: <Copy className="h-4 w-4" />, label: 'Duplicate', onClick: () => clone(e.packageId), disabled: cloning === e.packageId },
                          ]}
                        />
                      )}
                    </SortableOfferingCard>
                  ))}
                </OfferingItems>
              </SortableOfferingList>
            )}

            <AddOfferingLink href="/offerings/new?kind=oneoff" label="New event" />
          </>
        )}
      </OfferingPage>
    </>
  )
}

/** The headline price: a single figure, or the range across ticket types. */
function ticketLabel(e: EventRow, currency: string): string | null {
  if (e.tiers.length > 0) {
    const prices = e.tiers.map(t => t.priceCents ?? 0)
    const low = Math.min(...prices)
    const high = Math.max(...prices)
    return low === high ? formatMoney(low, currency) : `${formatMoney(low, currency)} – ${formatMoney(high, currency)}`
  }
  return e.priceCents != null ? formatMoney(e.priceCents, currency) : null
}

function eventFacts(e: EventRow, currency: string): OfferingFact[] {
  const facts: OfferingFact[] = [
    { icon: <CalendarDays className="h-3.5 w-3.5" />, label: e.whenLabel },
    { icon: <Ticket className="h-3.5 w-3.5" />, label: `${e.durationMins} min` },
  ]
  if (e.location) facts.push({ icon: <MapPin className="h-3.5 w-3.5" />, label: e.location })

  const left = e.capacity == null ? null : Math.max(0, e.capacity - e.booked)
  facts.push({
    icon: <Users className="h-3.5 w-3.5" />,
    label: e.capacity == null ? `${e.booked} booked` : `${e.booked} of ${e.capacity} booked`,
    tone: left === 0 ? 'bad' : left != null && left <= 3 ? 'warn' : 'default',
  })

  // Ticket types are the thing you most often want to check before opening it.
  if (e.tiers.length > 0) {
    facts.push({
      icon: <Ticket className="h-3.5 w-3.5" />,
      label: e.tiers.map(t => `${t.name} ${formatMoney(t.priceCents ?? 0, currency)}`).join(' · '),
    })
  }
  return facts
}
