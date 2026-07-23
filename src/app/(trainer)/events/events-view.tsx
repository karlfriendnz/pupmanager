'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CalendarPlus, Plus, MapPin, Users, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/page-header'
import { formatMoney } from '@/lib/money'

export type EventTier = { id: string; name: string; priceCents: number | null; capacity: number | null }

export type EventRow = {
  id: string
  name: string
  whenLabel: string
  location: string | null
  imageUrl: string | null
  status: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
  capacity: number | null
  booked: number
  priceCents: number | null
  tiers: EventTier[]
  isPast: boolean
}

const STATUS_STYLE: Record<EventRow['status'], string> = {
  SCHEDULED: 'bg-blue-50 text-blue-700',
  RUNNING: 'bg-emerald-50 text-emerald-700',
  COMPLETED: 'bg-slate-100 text-slate-600',
  CANCELLED: 'bg-red-50 text-red-600',
}

// Upcoming / Past, the same pill-tab bar as Group Classes and Drop-ins — a long
// history of finished workshops shouldn't bury the one that's on next.
export function EventsView({ events, currency }: { events: EventRow[]; currency: string }) {
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')

  // Server hands them back newest-first. Upcoming reads better soonest-first.
  const upcoming = events.filter(e => !e.isPast).reverse()
  const past = events.filter(e => e.isPast)
  const shown = tab === 'past' ? past : upcoming

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="One-off events clients sign up to — workshops, seminars and meet-ups, with tickets, capacity and a guest list."
      />
      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">
        {events.length === 0 ? (
          <Card>
            <CardBody>
              <div className="flex flex-col items-center py-12 px-4 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                  <CalendarPlus className="h-6 w-6" />
                </div>
                <p className="mt-4 font-medium text-slate-700">No events yet</p>
                <p className="mt-1 max-w-sm text-sm text-slate-400">
                  Set up a one-off event on a single date — pick the time, add ticket
                  types and a capacity, and share the sign-up with your clients.
                </p>
                <Link href="/offerings/new?kind=oneoff" className="mt-5">
                  <Button>
                    <Plus className="h-4 w-4" /> New event
                  </Button>
                </Link>
              </div>
            </CardBody>
          </Card>
        ) : (
          <>
            <div className="mb-4 inline-flex gap-1 rounded-xl bg-slate-100 p-1">
              {([['upcoming', `Upcoming${upcoming.length ? ` · ${upcoming.length}` : ''}`], ['past', `Past${past.length ? ` · ${past.length}` : ''}`]] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTab(v)}
                  aria-pressed={tab === v}
                  className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-all ${tab === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <Card>
                <CardBody>
                  <div className="py-10 px-4 text-center">
                    <CalendarPlus className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                    <p className="font-medium text-slate-600">
                      {tab === 'past' ? 'No past events' : 'Nothing coming up'}
                    </p>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">
                      {tab === 'past'
                        ? 'Events move here once their date has been, or when you mark them complete or cancelled.'
                        : 'Every event you have has been. Put another one in the diary.'}
                    </p>
                  </div>
                </CardBody>
              </Card>
            ) : (
              <div className="flex flex-col gap-3">
                {shown.map(e => (
                  <Link key={e.id} href={`/classes/${e.id}`} className="block">
                    <Card>
                      <CardBody>
                        <div className="flex items-start gap-3">
                          {e.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={e.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-slate-800">{e.name}</p>
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[e.status]}`}>
                                {e.status.charAt(0) + e.status.slice(1).toLowerCase()}
                              </span>
                            </div>
                            <p className="mt-0.5 text-sm text-slate-500">{e.whenLabel}</p>

                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                              {e.location && (
                                <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{e.location}</span>
                              )}
                              <span className="inline-flex items-center gap-1.5">
                                <Users className="h-3.5 w-3.5" />
                                {e.capacity == null ? `${e.booked} booked` : `${e.booked} of ${e.capacity} booked`}
                              </span>
                              {e.tiers.length > 0 ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <Ticket className="h-3.5 w-3.5" />
                                  {e.tiers.length} ticket type{e.tiers.length === 1 ? '' : 's'}
                                  {' · '}
                                  {ticketRange(e.tiers, currency)}
                                </span>
                              ) : e.priceCents != null && (
                                <span className="inline-flex items-center gap-1.5">
                                  <Ticket className="h-3.5 w-3.5" />{formatMoney(e.priceCents, currency)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                  </Link>
                ))}
              </div>
            )}

            {/* Add sits at the BOTTOM of the list, like Classes and Drop-ins. */}
            <Link
              href="/offerings/new?kind=oneoff"
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 py-3.5 text-sm font-medium text-slate-500 transition-colors hover:border-blue-300 hover:text-blue-600"
            >
              <Plus className="h-4 w-4" /> New event
            </Link>
          </>
        )}
      </div>
    </>
  )
}

/** "$40" for one price, "$40 – $60" across tiers. Unpriced tiers read as free. */
function ticketRange(tiers: EventTier[], currency: string): string {
  const prices = tiers.map(t => t.priceCents ?? 0)
  const low = Math.min(...prices)
  const high = Math.max(...prices)
  return low === high ? formatMoney(low, currency) : `${formatMoney(low, currency)} – ${formatMoney(high, currency)}`
}
