'use client'

// The event screen. Deliberately NOT the group-class screen: an event happens
// once and sells named tickets, so there is no session list to step through and
// no single "the price" — every ticket type is shown, because a trainer reading
// one figure for an offering that sells three is reading the wrong number.
//
// The roster, the enrol flow and the label/value rows come from
// components/trainer/run-roster.tsx, shared with the class screen — those parts
// really are the same job and must not drift.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '@/components/shared/page-header'
import { CardHeading } from '@/components/shared/card-heading'
import { OfferingActions } from '@/components/trainer/offering-actions'
import { RichText } from '@/components/shared/rich-text'
import { isRichTextEmpty } from '@/lib/rich-text'
import { Users, UserPlus, Info, Bell, Tag, Ticket } from 'lucide-react'
import { useCurrency } from '@/components/currency-context'
import { formatMoney } from '@/lib/money'
import { CommsFlowEditor } from '@/components/trainer/comms-flow-editor'
import { ClientSnapshotRow } from '@/components/shared/client-snapshot-row'
import { DiscountManager } from '@/components/trainer/discount-manager'
import { OfferingTabs, type OfferingTab } from '@/components/shared/offering-tabs'
import {
  EnrollTable, EnrolModal, Detail, groupByClient,
  type Enrollment, type ClientOpt, type TicketTier,
} from '@/components/trainer/run-roster'

type Tab = 'details' | 'guests' | 'messages' | 'discounts'

export type EventRun = {
  id: string
  /** The offering behind this event — where the full-page editor lives. */
  packageId: string
  name: string
  description: string | null
  startsAt: string
  location: string | null
  status: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
  capacity: number | null
  durationMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  allowWaitlist: boolean
  imageUrl: string | null
  /** Only used when the event sells no ticket types. */
  priceCents: number | null
  assignedTrainers: { membershipId: string; name: string; title: string | null }[]
}

export function EventDetail({
  event,
  tiers,
  enrollments,
  clients,
}: {
  event: EventRun
  tiers: TicketTier[]
  enrollments: Enrollment[]
  clients: ClientOpt[]
}) {
  const router = useRouter()
  const currency = useCurrency()
  const [tab, setTab] = useState<Tab>('details')
  const [guestTab, setGuestTab] = useState<'current' | 'past'>('current')
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const going = enrollments.filter(e => e.status === 'ENROLLED')
  const waitlisted = enrollments.filter(e => e.status === 'WAITLISTED')
  const present = enrollments.filter(e => e.status === 'ENROLLED' || e.status === 'WAITLISTED')
  const past = enrollments.filter(e => e.status === 'WITHDRAWN' || e.status === 'COMPLETED')
  // ONE ROW PER PERSON (per dog, strictly — the same owner bringing two dogs is
  // genuinely two lines, because attendance and invoices are per dog). An
  // enrolment is a BOOKING, not a person: someone who bought General AND VIP,
  // or came back for a second ticket, holds several, and the snapshot listed
  // their name once per booking. The guest TABLE already folded them with
  // groupByClient; this side panel and the counts beside it did not, so the
  // card read the same owner three times over a badge that disagreed with the
  // table underneath it. Same grouping everywhere now — the number on the tab
  // is the number of lines you'll find under it.
  const presentGroups = groupByClient(present)
  const pastGroups = groupByClient(past)
  const rosterCount = presentGroups.length + pastGroups.length

  // A ticket can be several places, so the headline is places sold, not rows.
  const placesTaken = going.reduce((n, e) => n + Math.max(1, e.quantity), 0)
  const seatsLabel = event.capacity == null
    ? `${placesTaken} going`
    : `${placesTaken} / ${event.capacity}`

  // What the event has actually sold: each guest at the price of the ticket
  // they hold, times how many. The old screen multiplied the offering's flat
  // price by a headcount, which for a ticketed event was never the real number.
  // ENROLLED only — a waitlisted guest is never invoiced, so counting them
  // would quote money that doesn't exist.
  const takings = going.reduce((sum, e) => {
    const unit = e.ticketPriceCents ?? (tiers.length === 0 ? event.priceCents : null)
    return unit == null ? sum : sum + unit * Math.max(1, e.quantity)
  }, 0)

  async function withdraw(enrollmentIds: string[]) {
    setError(null)
    const results = await Promise.all(
      enrollmentIds.map(id =>
        fetch(`/api/class-runs/${event.id}/enrollments/${id}`, { method: 'DELETE' })),
    )
    if (results.some(r => !r.ok)) setError('Could not remove that guest.')
    router.refresh()
  }

  const tabs: OfferingTab<Tab>[] = [
    { id: 'details', label: 'Details', icon: Info },
    { id: 'guests', label: 'Guest list', icon: Users, badge: rosterCount > 0 ? rosterCount : undefined },
    { id: 'messages', label: 'Automation', icon: Bell },
    { id: 'discounts', label: 'Discounts', icon: Tag },
  ]

  return (
    <>
      {/* Name and the way back. Edit and Delete live on the Details card with
          the rest of what you do to this event — same as every offering. */}
      <PageHeader
        title={event.name}
        back={{ href: '/events', label: 'Events' }}
      />

      <div className="p-4 md:p-8 w-full">
      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {/* Sticky and edge to edge, the same as the other offering screens
          (Karl). The page wrapper is p-4 md:p-8, so the negative margins break
          the strip out of it and the matching padding puts the tab text back
          in line with the content — otherwise its background and hairline stop
          short of the page. */}
      <div className="max-md:sticky max-md:top-[calc(env(safe-area-inset-top,0px)+3.5rem+1px)] z-20 max-md:-mx-4 mb-4 bg-white max-md:px-4 pt-2 md:pt-0 md:-mt-2">
        <OfferingTabs tabs={tabs} value={tab} onChange={setTab} className="mb-0" />
      </div>

      {/* Details: what the event is and what it sells (left), a compact guest
          snapshot (right). No sessions card — an event is one occasion. */}
      <div className={tab === 'details' ? 'grid grid-cols-1 lg:grid-cols-12 gap-5 items-start' : 'hidden'}>
        <div className="lg:col-span-7 flex flex-col gap-5">
          {event.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={event.imageUrl}
              alt={event.name}
              className="w-full h-40 sm:h-52 object-cover rounded-2xl border border-slate-200"
            />
          )}

          <Card>
            <CardBody className="py-5">
              <CardHeading
                icon={<Info className="h-4 w-4 text-slate-400" strokeWidth={1.75} />}
                action={
                  <OfferingActions
                    name={event.name}
                    noun="event"
                    editHref={`/packages/${event.packageId}/edit`}
                    packageId={event.packageId}
                    runId={event.id}
                    runKind="event"
                    backHref="/events"
                  />
                }
              >
                Details
              </CardHeading>
              <div className="divide-y divide-slate-100">
                <Detail label="Status" value={event.status.charAt(0) + event.status.slice(1).toLowerCase()} />
                <Detail
                  label="When"
                  value={new Date(event.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                />
                <Detail label="Length" value={`${event.durationMins} min`} />
                <Detail label="Format" value={event.sessionType === 'VIRTUAL' ? 'Virtual' : 'In person'} />
                <Detail label="Capacity" value={event.capacity == null ? 'Unlimited' : `${event.capacity} places`} />
                <Detail
                  label="Waitlist"
                  value={event.allowWaitlist
                    ? (waitlisted.length > 0 ? `Enabled, ${waitlisted.length}` : 'Enabled')
                    : 'Off'}
                />
                {event.location && <Detail label="Location" value={event.location} />}
                {/* "Takings", not "Taken" — the row above already counts
                    places taken, and two meanings of the word side by side is
                    a misread waiting to happen. */}
                <Detail label="Takings" value={takings > 0 ? formatMoney(takings, currency) : '—'} />
              </div>

              {!isRichTextEmpty(event.description) && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">About this event</p>
                  <RichText html={event.description} className="text-sm text-slate-600 leading-relaxed" />
                </div>
              )}

              {event.assignedTrainers.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Trainers</p>
                  <div className="flex flex-wrap gap-1.5">
                    {event.assignedTrainers.map(t => (
                      <span
                        key={t.membershipId}
                        className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1"
                      >
                        {t.name}{t.title ? <span className="text-blue-400 font-normal">· {t.title}</span> : null}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Every ticket type, with its price and how many are left. This is
              THE price question for an event, so it gets its own block rather
              than one "Price" row that can only ever show one of them. */}
          <Card>
            <CardBody className="py-5">
              <CardHeading
                icon={<Ticket className="h-4 w-4 text-slate-400" strokeWidth={1.75} />}
                count={tiers.length > 0 ? tiers.length : undefined}
              >
                Tickets
              </CardHeading>
              {tiers.length === 0 ? (
                <div className="divide-y divide-slate-100">
                  <Detail
                    label="Price"
                    value={event.priceCents == null ? 'Free' : formatMoney(event.priceCents, currency)}
                  />
                  <p className="pt-2.5 text-[11px] text-slate-400">
                    This event sells one price. Add ticket types on the edit page to charge
                    differently for early birds, members or a second dog.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {tiers.map(t => {
                    const left = t.capacity == null ? null : Math.max(0, t.capacity - t.sold)
                    return (
                      <li key={t.id} className="flex items-baseline gap-4 py-2.5 first:pt-0 last:pb-0">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">{t.name}</span>
                          <span className="block text-[11px] text-slate-400">
                            {t.capacity == null
                              ? `${t.sold} sold · unlimited`
                              : left === 0 ? `${t.sold} sold · sold out` : `${t.sold} sold · ${left} left`}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                          {formatMoney(t.priceCents ?? 0, currency)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-5">
          <Card>
            <CardBody className="py-5">
              <CardHeading
                icon={<Users className="h-4 w-4 text-slate-400" strokeWidth={1.75} />}
                note={seatsLabel}
                action={<Button variant="secondary" onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" /> Enrol</Button>}
              >
                Guests
              </CardHeading>
              {presentGroups.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">Nobody signed up yet.</p>
              ) : (
                <>
                  <ul className="divide-y divide-slate-100">
                    {presentGroups.slice(0, 6).map(g => (
                      <ClientSnapshotRow
                        key={g.key}
                        clientId={g.clientId}
                        clientName={g.clientName}
                        dogName={g.dogName}
                        badge={g.status === 'WAITLISTED' ? 'Waitlist' : null}
                      />
                    ))}
                  </ul>
                  {rosterCount > 6 && (
                    <button type="button" onClick={() => setTab('guests')} className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700">
                      View all {rosterCount} →
                    </button>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Guest list — the full roster (going / past). */}
      <div className={`flex flex-col gap-5 ${tab === 'guests' ? '' : 'hidden'}`}>
        <Card>
          <CardBody className="py-5">
            <CardHeading
              icon={<Users className="h-4 w-4 text-slate-400" strokeWidth={1.75} />}
              note={seatsLabel}
              action={<Button variant="secondary" onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" /> Enrol client</Button>}
            >
              Guest list
            </CardHeading>

            {enrollments.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">Nobody signed up yet.</p>
            ) : (
              <>
                <div className="mb-3 inline-flex gap-1 rounded-2xl bg-slate-100 p-1.5">
                  {/* Counts of ROWS THE TABLE WILL SHOW — folded per person per
                      dog, not of raw enrolments. See presentGroups above. */}
                  {([
                    { id: 'current' as const, label: 'Going', count: presentGroups.length },
                    { id: 'past' as const, label: 'Past', count: pastGroups.length },
                  ]).map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setGuestTab(t.id)}
                      aria-pressed={guestTab === t.id}
                      className={`inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm font-medium transition-all ${
                        guestTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {t.label}
                      <span className={`min-w-4 rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                        guestTab === t.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {t.count}
                      </span>
                    </button>
                  ))}
                </div>

                {guestTab === 'current' ? (
                  present.length > 0
                    ? <EnrollTable rows={present} onWithdraw={withdraw} withdrawable runId={event.id} dropInClass={false} ticketed={tiers.length > 0} />
                    : <p className="text-sm text-slate-500 py-4 text-center">Nobody going yet.</p>
                ) : (
                  past.length > 0
                    ? <EnrollTable rows={past} onWithdraw={withdraw} withdrawable={false} runId={event.id} dropInClass={false} ticketed={tiers.length > 0} />
                    : <p className="text-sm text-slate-500 py-4 text-center">No past guests.</p>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <div className={tab === 'messages' ? '' : 'hidden'}>
        <CommsFlowEditor
          runId={event.id}
          offeringName={event.name}
          location={event.location}
          clients={Array.from(
            new Map(
              enrollments
                .filter(e => e.status !== 'WITHDRAWN')
                .map(e => [e.clientId, { id: e.clientId, name: e.clientName, dog: e.dogName }]),
            ).values(),
          )}
        />
      </div>

      <div className={tab === 'discounts' ? '' : 'hidden'}>
        <DiscountManager packageId={event.packageId} />
      </div>

      {adding && (
        <EnrolModal
          runId={event.id}
          clients={clients}
          allowDropIn={false}
          sessions={[]}
          bookedByClient={new Map()}
          tiers={tiers}
          // One place per person on an event: someone already on the guest list
          // isn't offered again. (Extra tickets are a quantity, not a re-enrol.)
          existing={new Set(enrollments.filter(e => e.status !== 'WITHDRAWN').map(e => e.clientName))}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); router.refresh() }}
        />
      )}
      </div>
    </>
  )
}
