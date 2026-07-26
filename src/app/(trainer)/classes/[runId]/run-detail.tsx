'use client'

import { useState } from 'react'
import { RichText } from '@/components/shared/rich-text'
import { isRichTextEmpty } from '@/lib/rich-text'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '@/components/shared/page-header'
import { CardHeading } from '@/components/shared/card-heading'
import { Users, UserPlus, CalendarDays, ClipboardCheck, Pencil, Info, Bell, Tag } from 'lucide-react'
import { useCurrency } from '@/components/currency-context'
import { formatMoney } from '@/lib/money'
import { CommsFlowEditor } from '@/components/trainer/comms-flow-editor'
import { ClientSnapshotRow } from '@/components/shared/client-snapshot-row'
import { DiscountManager } from '@/components/trainer/discount-manager'
// The roster, the enrol flow and the label/value rows are shared with the event
// detail screen — see components/trainer/run-roster.tsx for why.
import {
  EnrollTable, EnrolModal, Detail, DetailPair, DeleteRunButton, groupByClient,
  type Enrollment, type ClientOpt, type SessionRow,
} from '@/components/trainer/run-roster'

type Tab = 'details' | 'clients' | 'messages' | 'discounts'
type RunStatus = 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
type AssignedTrainer = { membershipId: string; name: string; title: string | null }
type Run = {
  id: string
  /** The offering behind this class — where the full-page editor lives. */
  packageId: string
  name: string
  scheduleNote: string | null
  location: string | null
  description: string | null
  startDate: string
  status: RunStatus
  capacity: number | null
  packageName: string
  allowDropIn: boolean
  allowWaitlist: boolean
  priceCents: number | null
  durationMins: number
  // "Gap before the next session" — turnaround time blocked after each class.
  bufferMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  weeksBetween: number
  sessionCount: number
  defaultSessionFormId: string | null
  hasAttendance: boolean
  imageUrl: string | null
  requirePayment: boolean | null
  assignedMembershipIds: string[]
  assignedTrainers: AssignedTrainer[]
}
export function RunDetail({
  run,
  sessions,
  enrollments,
  clients,
  // Which offering section this run is being viewed under. A ClassRun powers
  // group classes (/classes), casual classes (/casual-classes) and doggy
  // daycare (/doggy-daycare) — so the back link, the post-delete redirect and
  // the session links all follow the section the trainer came in through,
  // instead of always dumping them on Group Classes (and its add-on gate).
  basePath = '/classes',
  backLabel = 'Classes',
}: {
  run: Run
  sessions: SessionRow[]
  enrollments: Enrollment[]
  clients: ClientOpt[]
  basePath?: string
  backLabel?: string
}) {
  const router = useRouter()
  const currency = useCurrency()
  const formatPrice = (cents: number | null): string =>
    cents === null || cents === undefined ? '—' : formatMoney(cents, currency)
  const [tab, setTab] = useState<Tab>('details')
  const [clientTab, setClientTab] = useState<'current' | 'past'>('current')
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const enrolled = enrollments.filter(e => e.status === 'ENROLLED')
  const waitlisted = enrollments.filter(e => e.status === 'WAITLISTED')
  const present = enrollments.filter(e => e.status === 'ENROLLED' || e.status === 'WAITLISTED')
  const past = enrollments.filter(e => e.status === 'WITHDRAWN' || e.status === 'COMPLETED')
  // ONE ROW PER PERSON (per dog, strictly — the same owner bringing two dogs is
  // genuinely two lines). An enrolment is a BOOKING: a daycare or drop-in client
  // with four Thursdays booked holds four of them, and every list keyed on raw
  // enrolments repeated their name four times. The roster table already folded
  // them with groupByClient; the Details-tab snapshot and all the counts beside
  // it did not, so the demo daycare read "Bailey's Owner" three times in a row
  // over a "27" badge above a table of 8 rows. Same grouping everywhere now, so
  // the number on the tab is the number of lines you'll find under it.
  const presentGroups = groupByClient(present)
  const pastGroups = groupByClient(past)
  const rosterCount = presentGroups.length + pastGroups.length
  // On a drop-in class a row is a BOOKING, not a person — the same client can
  // hold several — so counting rows as "5 enrolled" reads as five people and
  // makes the repeated names look like duplicates. Capacity is per session
  // there too, so a "5 / 8" against the whole run would be wrong as well.
  const dropInPeople = new Set(enrolled.map(e => e.clientId)).size
  // Seats are per session; bookings are not. The daycare run reads 27 bookings
  // across 8 dogs, and counting bookings against an 8-seat capacity printed
  // "27 / 8" — a class three times over its limit, which it isn't. Count the
  // rows the roster actually shows. On an ordinary class one client holds one
  // enrolment, so this is unchanged there.
  const enrolledRows = groupByClient(enrolled).length
  const seatsLabel = run.allowDropIn
    ? `${dropInPeople} client${dropInPeople === 1 ? '' : 's'} · ${enrolled.length} booking${enrolled.length === 1 ? '' : 's'}`
    : run.capacity == null
      ? `${enrolledRows} enrolled`
      : `${enrolledRows} / ${run.capacity}`

  // Revenue estimate: full price per non-withdrawn enrolment (drop-ins excluded
  // from the headline — their per-session pricing is computed elsewhere).
  const billable = enrollments.filter(e => e.status !== 'WITHDRAWN' && e.type === 'FULL').length
  const revenue = run.priceCents != null ? run.priceCents * billable : null


  // Takes a list: a drop-in client is one row on the roster but can hold
  // several bookings, and withdrawing them is one action, one refresh.
  async function withdraw(enrollmentIds: string[]) {
    setError(null)
    const results = await Promise.all(
      enrollmentIds.map(id =>
        fetch(`/api/class-runs/${run.id}/enrollments/${id}`, { method: 'DELETE' })),
    )
    if (results.some(r => !r.ok)) setError('Could not withdraw that enrolment.')
    router.refresh()
  }

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }[] = [
    { id: 'details', label: 'Details', icon: Info },
    { id: 'clients', label: 'Clients', icon: Users, badge: rosterCount > 0 ? rosterCount : undefined },
    { id: 'messages', label: 'Reminders & messages', icon: Bell },
    { id: 'discounts', label: 'Discounts', icon: Tag },
  ]

  return (
    <>
      <PageHeader
        title={run.name}
        back={{ href: basePath, label: backLabel }}
        // Delete / Edit belong with the other page-level controls in the top
        // bar, not floating above the content.
        actions={
          <div className="flex items-center gap-2">
            <DeleteRunButton
              runId={run.id}
              label="class"
              confirmText="Delete this class?"
              onError={setError}
              onDeleted={() => {
                // refresh() first so the /classes list re-renders without the
                // run — pushing alone can serve the cached (stale) render.
                router.refresh()
                router.push(basePath)
              }}
            />
            {/* The whole class is edited on one full page — the same form, in
                the same order, as the wizard that created it. */}
            <Link href={`/packages/${run.packageId}/edit`}>
              <Button variant="secondary">
                <Pencil className="h-4 w-4" /> <span className="hidden sm:inline">Edit</span>
              </Button>
            </Link>
          </div>
        }
      />

      {/* Full width — two columns of detail need the room, and capping it
          wastes half a wide monitor. */}
      {/* min-w-0: the roster table below carries a min-width so its six
          columns stay legible, and without this the flex chain up to <main>
          takes its automatic minimum size from that table and the whole PAGE
          scrolls sideways on a phone. The table's own overflow-x-auto is the
          only thing that should scroll. */}
      <div className="p-4 md:p-8 w-full min-w-0">
      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {/* Tabs — Details, Clients, Reminders & messages, Discounts. Scrolls
          sideways on a narrow phone. */}
      <div className="mb-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="inline-flex gap-1 p-1 bg-slate-100 rounded-2xl">
        {tabs.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative shrink-0 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
                tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              {t.badge != null && (
                <span className={`min-w-4 h-4 px-1 text-[10px] font-semibold tabular-nums rounded-full flex items-center justify-center ${
                  tab === t.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                }`}>
                  {t.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
      </div>

      {/* Details tab: what you're selling (left, 7 of 12) + a compact clients
          snapshot (right, 5) — the same 7/5 split as the package detail and the
          membership builder. The full roster lives under the Clients tab. */}
      <div className={tab === 'details' ? 'grid grid-cols-1 lg:grid-cols-12 gap-5 items-start' : 'hidden'}>

      <div className="lg:col-span-7 flex flex-col gap-5">

          {run.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={run.imageUrl}
              alt={run.name}
              className="w-full h-40 sm:h-52 object-cover rounded-2xl border border-slate-200"
            />
          )}

          {/* Class details */}
          <Card>
            <CardBody className="py-5">
              <CardHeading icon={<Info className="h-4 w-4 text-slate-400" />}>Details</CardHeading>
              <div className="divide-y divide-slate-100">
                {/* Read-only here, like every other fact on this card. It's
                    changed on the edit page, with the rest of the class. */}
                <Detail label="Status" value={run.status.charAt(0) + run.status.slice(1).toLowerCase()} />
                <Detail label="Schedule" value={run.scheduleNote || 'Weekly'} />
                <Detail label="Starts" value={new Date(run.startDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} />
                <Detail label="Length" value={`${run.durationMins} min`} />
                <Detail label="Format" value={run.sessionType === 'VIRTUAL' ? 'Virtual' : 'In person'} />
                <Detail
                  label="Waitlist"
                  value={run.allowWaitlist
                    ? (waitlisted.length > 0 ? `Enabled, ${waitlisted.length}` : 'Enabled')
                    : 'Off'}
                />
                {run.allowDropIn && <Detail label="Drop-ins" value="Allowed" />}
                {/* Price and revenue read together — what one seat costs, and
                    what the class has sold — so they share a row. */}
                <DetailPair
                  label="Price" value={formatPrice(run.priceCents)}
                  label2="Revenue" value2={revenue != null ? formatPrice(revenue) : '—'}
                />
                {run.location && <Detail label="Location" value={run.location} />}
              </div>
              {/* The description is what clients are sent when they're booked
                  in, so it's worth seeing here rather than only in the edit
                  form — it's the thing you check before enrolling someone. */}
              {!isRichTextEmpty(run.description) && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">About this class</p>
                  <RichText html={run.description} className="text-sm text-slate-600 leading-relaxed" />
                </div>
              )}
              {run.assignedTrainers.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Trainers</p>
                  <div className="flex flex-wrap gap-1.5">
                    {run.assignedTrainers.map(t => (
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

          {/* Sessions */}
          <Card>
            <CardBody className="py-5">
              <CardHeading icon={<CalendarDays className="h-4 w-4 text-slate-400" />} count={sessions.length}>
                Sessions
              </CardHeading>
              {sessions.length === 0 ? (
                <p className="text-sm text-slate-500 py-2">No sessions scheduled.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {sessions.map(s => (
                    <li key={s.id}>
                      {/* The whole row is the link — the "Open" button was a
                          small target for something the entire row means. */}
                      <Link
                        href={`${basePath}/${run.id}/sessions/${s.id}`}
                        className="flex items-center gap-4 rounded-lg py-2.5 px-2 -mx-2 hover:bg-slate-50"
                      >
                        <p className="w-24 shrink-0 text-sm font-medium text-slate-900">Session {s.sessionIndex ?? '—'}</p>
                        <p className="min-w-0 flex-1 text-sm text-slate-600" suppressHydrationWarning>
                          {new Date(s.scheduledAt).toLocaleDateString([], { dateStyle: 'medium' })}
                        </p>
                        {/* Explicit hour12 — the browser locale renders 19:00
                            here, and trainers read their day in am/pm. */}
                        <p className="w-24 shrink-0 text-sm tabular-nums text-slate-600" suppressHydrationWarning>
                          {new Date(s.scheduledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                        </p>
                        <span className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 h-9 text-sm font-medium text-slate-600">
                          <ClipboardCheck className="h-4 w-4" /> Open
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
      </div>

        {/* Compact clients snapshot — the "small version" on the Details tab. */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          <Card>
            <CardBody className="py-5">
              <CardHeading
                icon={<Users className="h-4 w-4 text-slate-400" />}
                note={seatsLabel}
                action={<Button variant="secondary" onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" /> Enrol</Button>}
              >
                Clients
              </CardHeading>
              {presentGroups.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">No one enrolled yet.</p>
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
                    <button type="button" onClick={() => setTab('clients')} className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700">View all {rosterCount} →</button>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Clients tab — the full roster (current / past). */}
      <div className={`flex min-w-0 flex-col gap-5 ${tab === 'clients' ? '' : 'hidden'}`}>
          <Card>
            <CardBody className="py-5">
              <CardHeading
                icon={<Users className="h-4 w-4 text-slate-400" />}
                note={seatsLabel}
                action={
                  <Button variant="secondary" onClick={() => setAdding(true)}>
                    <UserPlus className="h-4 w-4" /> Enrol client
                  </Button>
                }
              >
                Clients
              </CardHeading>

              {enrollments.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">No one enrolled yet.</p>
              ) : (
                <>
                  {/* Current / past as tabs rather than two stacked tables —
                      a long history of withdrawals shouldn't push who's
                      actually in the class off the bottom.

                      Flat text tabs on one hairline that runs the full width,
                      not a pill track: the pill was a short island with a wide
                      band of nothing to the right of it, which is exactly the
                      dead space Karl marked. The rule now carries across to
                      meet the table's top edge, so the two read as one object.
                      Counts are of ROWS in the table below (one per person),
                      not of raw enrolments — see presentGroups above. */}
                  <div className="mb-3 flex gap-5 border-b border-slate-200">
                    {([
                      { id: 'current' as const, label: 'Current', count: presentGroups.length },
                      { id: 'past' as const, label: 'Past', count: pastGroups.length },
                    ]).map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setClientTab(t.id)}
                        aria-pressed={clientTab === t.id}
                        className={`-mb-px shrink-0 border-b-2 py-2 text-sm font-medium transition-colors ${
                          clientTab === t.id
                            ? 'border-slate-900 text-slate-900'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {t.label}
                        <span className="ml-1.5 text-[11px] font-normal tabular-nums text-slate-400">{t.count}</span>
                      </button>
                    ))}
                  </div>

                  {clientTab === 'current' ? (
                    presentGroups.length > 0
                      ? <EnrollTable rows={present} onWithdraw={withdraw} withdrawable runId={run.id} dropInClass={run.allowDropIn} />
                      : <p className="text-sm text-slate-500 py-4 text-center">No one currently enrolled.</p>
                  ) : (
                    pastGroups.length > 0
                      ? <EnrollTable rows={past} onWithdraw={withdraw} withdrawable={false} runId={run.id} dropInClass={run.allowDropIn} />
                      : <p className="text-sm text-slate-500 py-4 text-center">No past clients.</p>
                  )}
                </>
              )}
            </CardBody>
          </Card>
      </div>

      {/* Reminders & messages tab — automated comms for this class. */}
      <div className={tab === 'messages' ? '' : 'hidden'}>
        <CommsFlowEditor
          runId={run.id}
          offeringName={run.name}
          location={run.location}
          clients={Array.from(
            new Map(
              enrollments
                .filter(e => e.status !== 'WITHDRAWN')
                .map(e => [e.clientId, { id: e.clientId, name: e.clientName, dog: e.dogName }]),
            ).values(),
          )}
        />
      </div>

      {/* Discounts — the system-wide engine, attached to this offering's package. */}
      <div className={tab === 'discounts' ? '' : 'hidden'}>
        <DiscountManager packageId={run.packageId} />
      </div>

      {adding && (
        <EnrolModal
          runId={run.id}
          clients={clients}
          allowDropIn={run.allowDropIn}
          sessions={sessions}
          // Which sessions each client already holds, so the picker can show
          // them as booked instead of letting you tick one and be refused.
          bookedByClient={enrollments.reduce((m, e) => {
            if (e.status === 'WITHDRAWN' || !e.dropInSessionId) return m
            const set = m.get(e.clientId) ?? new Set<string>()
            set.add(e.dropInSessionId)
            return m.set(e.clientId, set)
          }, new Map<string, Set<string>>())}
          // Only a FULL enrolment takes someone out of the running — they're
          // already in every session. Someone with drop-ins booked can still
          // be added to more, so they stay pickable.
          existing={new Set(
            enrollments.filter(e => e.status !== 'WITHDRAWN' && e.type === 'FULL').map(e => e.clientName),
          )}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false)
            router.refresh()
          }}
        />
      )}

      </div>
    </>
  )
}
