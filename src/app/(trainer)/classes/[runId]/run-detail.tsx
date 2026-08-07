'use client'

import { useState } from 'react'
import { RichText } from '@/components/shared/rich-text'
import { isRichTextEmpty } from '@/lib/rich-text'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '@/components/shared/page-header'
import { CardHeading } from '@/components/shared/card-heading'
import { useOfferingActions } from '@/components/trainer/offering-actions'
import { EditScreen } from '@/components/shared/edit-screen'
import { Plus, Pencil } from 'lucide-react'
import { Users, UserPlus, Info, Bell, Tag, ListChecks } from 'lucide-react'
import { useCurrency } from '@/components/currency-context'
import { formatMoney } from '@/lib/money'
import { CommsFlowEditor } from '@/components/trainer/comms-flow-editor'
import { ClassGroupPanel } from '@/components/trainer/class-group-panel'
import { SeriesCurriculumEditor, type ScheduledSession } from '@/components/trainer/series-curriculum-editor'
import { OfferingViewToggle, useOfferingView } from '@/components/shared/offering-card'
import { ClientSnapshotRow } from '@/components/shared/client-snapshot-row'
import { DiscountManager } from '@/components/trainer/discount-manager'
import { OfferingTabs, type OfferingTab } from '@/components/shared/offering-tabs'
// The roster, the enrol flow and the label/value rows are shared with the event
// detail screen — see components/trainer/run-roster.tsx for why.
import {
  EnrollTable, EnrolModal, Detail, DetailPair, groupByClient,
  type Enrollment, type ClientOpt, type SessionRow,
} from '@/components/trainer/run-roster'

type Tab = 'details' | 'clients' | 'homework' | 'messages' | 'discounts'

/**
 * One step of this class's curriculum, with the homework that follows it.
 *
 * A class works through its curriculum as a COHORT — step 1 is week 1 — so a
 * session's step is simply its own session number and nothing is stored per
 * client. That is `stepForIndex` in lib/series.ts, and it is why this screen
 * needs only the step list, not a per-session lookup.
 */
export type CurriculumStepRow = {
  id: string
  sessionIndex: number
  title: string
  description: string | null
  /** Titles of the default homework this step hands out. */
  homework: string[]
}
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
  /** What a FULL seat costs: every session in the run at its own price. */
  fullRunPriceCents: number | null
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
  // The curriculum, when this class runs one. Empty = it doesn't, and every
  // step-aware thing below simply doesn't render — a series is a curriculum on
  // an ordinary class, not a different kind of class, so there is no second
  // screen and no flag to route on.
  steps = [],
}: {
  run: Run
  sessions: SessionRow[]
  enrollments: Enrollment[]
  clients: ClientOpt[]
  basePath?: string
  backLabel?: string
  steps?: CurriculumStepRow[]
}) {
  const router = useRouter()
  const currency = useCurrency()
  const formatPrice = (cents: number | null): string =>
    cents === null || cents === undefined ? '—' : formatMoney(cents, currency)
  const [tab, setTab] = useState<Tab>('details')
  // The Sessions tab's controls belong to the LIST. Inside one session they
  // are actions with nothing to act on, so the editor tells us which it is on.
  const [onSessionList, setOnSessionList] = useState(true)
  const [sessionView, setSessionView] = useOfferingView('class-sessions')
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

  // The run's sessions, in the shape the Sessions tab's list wants them. `href`
  // rather than an id, because the same run is reachable under /classes,
  // /casual-classes and /doggy-daycare and the link has to follow whichever the
  // trainer came in through.
  const scheduledSessions: ScheduledSession[] = sessions.map(s => ({
    id: s.id,
    sessionIndex: s.sessionIndex,
    scheduledAt: s.scheduledAt,
    href: `${basePath}/${run.id}/sessions/${s.id}`,
    // Everything the "cancel / move just this one" sheet needs. It is a RUN,
    // so every row has one — a 1:1 package's dates, which share this list,
    // don't.
    occurrence: {
      id: s.id,
      runId: run.id,
      scheduledAt: s.scheduledAt,
      durationMins: s.durationMins ?? run.durationMins,
      location: s.location ?? null,
      cancelledAt: s.cancelledAt ?? null,
      cancelReason: s.cancelReason ?? null,
      scheduleOverriddenAt: s.scheduleOverriddenAt ?? null,
    },
    bookedCount: s.bookedCount,
  }))

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

  // What to call this thing in the action menu. The same component serves
  // /classes, /casual-classes and /doggy-daycare, and "Delete this class" on a
  // daycare programme reads as somebody else's screen.
  const offeringNoun =
    basePath === '/casual-classes' ? 'casual class'
    : basePath === '/doggy-daycare' ? 'programme'
    : 'class'
  // Edit, and everything occasional behind the ⋯ — the same hook the 1:1
  // session screen uses, so the routes, confirmations and refusal prose have
  // one copy between them rather than one per offering kind.
  const runActions = useOfferingActions({
    name: run.name,
    noun: offeringNoun,
    editHref: `/packages/${run.packageId}/edit`,
    packageId: run.packageId,
    runId: run.id,
    // Daycare deliberately passes nothing: it converts nowhere, so it is
    // offered nothing rather than something the API would refuse.
    runKind: basePath === '/casual-classes' ? 'casual' : basePath === '/classes' ? 'class' : undefined,
    backHref: basePath,
  })

  const tabs: OfferingTab<Tab>[] = [
    { id: 'details', label: 'Details', icon: Info },
    { id: 'clients', label: 'Clients', icon: Users, badge: rosterCount > 0 ? rosterCount : undefined },
    // Named for what it CONTAINS: the run's sessions, each carrying a
    // description and its homework. Calling it "Homework" hid half of that —
    // and hid the list entirely (found the hard way).
    //
    // It used to say "Homework" for a one-session run on the grounds that there
    // was nothing to list. There still is: that single session has a
    // description and a write-up of its own, and a trainer looking for it went
    // to a tab that did not sound like it held one. One word in both cases is
    // also one less thing to explain.
    // Shared by /classes, /casual-classes and /doggy-daycare.
    { id: 'homework', label: 'Sessions', icon: ListChecks, badge: steps.length > 0 ? steps.length : undefined },
    { id: 'messages', label: 'Automation', icon: Bell },
    { id: 'discounts', label: 'Discounts', icon: Tag },
  ]

  return (
    <>
      {/* Name and the way back, nothing else. Edit and Delete are things you do
          to THIS class, so they sit on the card that describes it — the same
          place, and the same component, as every other offering. */}
      <PageHeader
        title={run.name}
        back={{ href: basePath, label: backLabel }}
      />

      {/* Full width — two columns of detail need the room, and capping it
          wastes half a wide monitor. */}
      {/* min-w-0: the roster table below carries a min-width so its six
          columns stay legible, and without this the flex chain up to <main>
          takes its automatic minimum size from that table and the whole PAGE
          scrolls sideways on a phone. The table's own overflow-x-auto is the
          only thing that should scroll. */}
      <div className="p-4 md:p-8 w-full min-w-0">
      {/* The house shell: the five bottom tabs stand down, and the screen's
          actions are pinned to the foot instead of floating in a card (Karl:
          "things like the primary button, nav bar, tabs, headings"). The
          action follows the TAB, same rule as the 1:1 session screen. */}
      <EditScreen
        menu={runActions.menu}
        menuTitle={run.name}
        primary={
          tab === 'clients'
            ? { label: 'Add', icon: <Plus className="h-4 w-4" strokeWidth={2} />, onClick: () => setAdding(true) }
            // Automation, Sessions and Discounts get none. Their steps, sessions
            // and rules each carry their own controls, and "Edit" there offered
            // to edit the CLASS while you were inside one of them. It stays in
            // the ⋯ on every tab.
            : tab === 'details'
              ? { label: 'Edit', href: runActions.editHref, icon: <Pencil className="h-4 w-4" strokeWidth={1.75} /> }
              : undefined
        }
      >
      {runActions.error && <Alert variant="error" className="mb-4">{runActions.error}</Alert>}
      {runActions.overlays}
      {error && <Alert variant="error" className="mb-4">{error}</Alert>}

      {/* Tabs — Details, Clients, Automation, Discounts. Icon on top on a phone
          (the labels are too long to sit beside one at 390px).

          The tab's own actions sit on the SAME line, at the right, the way
          every other screen in the app puts them — the roster's Enrol button
          and seat count came off a card heading to get here. */}
      {/* Sticky and edge to edge, the same as the 1:1 session screen (Karl:
          "apply all the same logic to the other offering pages"). The page
          wrapper is p-4 md:p-8, so the negative margins break the strip out of
          it and the matching padding puts the tab text back in line with the
          content — otherwise the white background and the hairline stop short
          of the page. The roster is longer than a phone, so without sticky,
          switching tab means scrolling back up to find the switch. */}
      <div className="max-md:sticky max-md:top-[calc(env(safe-area-inset-top,0px)+3.5rem+1px)] z-20 max-md:-mx-4 max-md:-mt-6 max-md:-mb-2 md:mb-4 flex items-end justify-between gap-3 bg-white max-md:px-4 pt-2 md:pt-0 md:-mt-2">
        <OfferingTabs tabs={tabs} value={tab} onChange={setTab} className="mb-0 min-w-0 flex-1" />
        {tab === 'clients' && seatsLabel && (
          <span className="hidden flex-shrink-0 pb-1.5 text-xs text-slate-500 sm:inline">{seatsLabel}</span>
        )}
        {tab === 'homework' && onSessionList && (
          <span className="flex flex-shrink-0 items-center gap-2 pb-1.5">
            <OfferingViewToggle value={sessionView} onChange={setSessionView} />
          </span>
        )}
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
              {/* No heading, and no actions in it. "Details" repeated the
                  selected tab directly above, and Edit/More are the SCREEN's
                  actions — they're in the pinned bar now, like every other
                  offering screen (Karl). */}
              <div className="divide-y divide-slate-100">
                {/* Read-only here, like every other fact on this card. It's
                    changed on the edit page, with the rest of the class. */}
                <Detail label="Status" value={run.status.charAt(0) + run.status.slice(1).toLowerCase()} />
                <Detail label="Schedule" value={run.scheduleNote || 'Weekly'} />
                <Detail label="Starts" value={new Date(run.startDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} />
                <Detail label="Length" value={`${run.durationMins} min`} />
                <Detail label="Format" value={run.sessionType === 'VIRTUAL' ? 'Virtual' : 'In person'} />
                {/* How full it is, and where the overflow goes — the two
                    halves of the same question, so they share a row. Capacity
                    was missing from this card altogether: the number was set on
                    the edit page and then never shown back anywhere, so there
                    was nothing to check a change against. */}
                <DetailPair
                  label="Capacity"
                  value={run.capacity == null
                    ? 'No limit'
                    // A drop-in class caps each SESSION, not the run — quoting
                    // "3 of 8" against the whole term there would be the same
                    // mistake as the old "27 / 8" the roster count already fixed.
                    : run.allowDropIn
                      ? `${run.capacity} per session`
                      : `${enrolledRows} of ${run.capacity}`}
                  label2="Waitlist"
                  value2={run.allowWaitlist
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

          {/* The Sessions card that used to sit here has MOVED to the Sessions
              tab, merged into the curriculum list — one list of the run's
              sessions carrying the date, the step and the homework together,
              rather than the dates here and what they cover one tab away. No
              stub is left behind: a card pointing at another tab is just the
              same split with an extra click. */}
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

      {/* Clients tab — the full roster (current / past).
          No card around it and no "Clients" heading inside: the tab you are
          standing on already says which is which, and a card drawn around the
          only thing on a tab is a border separating it from nothing. The roster
          IS the tab. Enrol and the seat count move up to the row of tabs. */}
      <div className={`flex min-w-0 flex-col gap-5 ${tab === 'clients' ? '' : 'hidden'}`}>
              {enrollments.length === 0 ? (
                <p className="rounded-xl border border-slate-200 bg-white py-8 text-center text-sm text-slate-500">No one enrolled yet.</p>
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
      </div>

      {/* Curriculum tab — what each session covers and the homework that
          follows it. They live on the offering (the package), so every run of
          the class shares one list rather than each cohort being set up again.
          `SeriesCurriculumEditor` IS the homework editor with a plan field over
          each session's bucket, so this stayed one tab: two editors of the same
          rows would drift, and a class with no steps named renders exactly the
          homework editor that was here before. */}
      {/* Full width, not max-w-2xl: this is a LIST of the run's sessions now,
          not a narrow form, and each row carries a title, a description hint and
          a homework count. */}
      {/* The booked DATES are merged in here too. They used to be a second list
          on the Details tab — the same six sessions, on another tab, so telling
          which week covered loose-lead meant reading both and matching them up
          by number. One row per session now carries its date, its step and its
          homework: the row opens the plan, the link opens the session. */}
      <div className={tab === 'homework' ? '' : 'hidden'}>
        <SeriesCurriculumEditor
          packageId={run.packageId}
          sessionCount={run.sessionCount}
          isGroup
          scheduledSessions={scheduledSessions}
          view={sessionView}
          onViewingListChange={setOnSessionList}
        />
      </div>

      {/* Automation tab — what this class sends on its own, plus the
          way into a GROUP for it. Its natural home: no new nav, and it is
          where a trainer already comes to think about talking to this class.
          A comms flow is timed and one-way; a group is a conversation. */}
      <div className={tab === 'messages' ? '' : 'hidden'}>
        <ClassGroupPanel runId={run.id} runName={run.name} />
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
          fullRunPriceCents={run.fullRunPriceCents}
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

      </EditScreen>
      </div>
    </>
  )
}
