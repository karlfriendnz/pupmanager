'use client'

import { useState, useEffect } from 'react'
import { RichText } from '@/components/shared/rich-text'
import { isRichTextEmpty } from '@/lib/rich-text'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardBody } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/page-header'
import { ClientAvatar } from '@/components/shared/client-avatar'
import { ClientSnapshotRow } from '@/components/shared/client-snapshot-row'
import { CardHeading } from '@/components/shared/card-heading'
import { useOfferingActions, OfferingActions } from '@/components/trainer/offering-actions'
import { EditScreen } from '@/components/shared/edit-screen'
import { Info, Users, Package as PackageIcon, Bell, MessageSquare, ListChecks, Pencil, Plus, ChevronRight } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { CommsFlowEditor } from '@/components/trainer/comms-flow-editor'
import { AddSessionButton, SeriesCurriculumEditor } from '@/components/trainer/series-curriculum-editor'
import { OfferingTabs, type OfferingTab } from '@/components/shared/offering-tabs'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { FlatBlock } from '@/components/shared/flat-list'

// 'discounts' is deliberately absent: the discount engine is built but not
// something we're showing trainers yet, so the tab and its panel are off. Put
// it back here and in `tabs` below when it ships — nothing else has to change.
type Tab = 'details' | 'clients' | 'messages' | 'homework'

export type PackageInfo = {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  priceCents: number | null
  specialPriceCents: number | null
  sessionCount: number
  weeksBetween: number
  durationMins: number
  bufferMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  isGroup: boolean
  requireSessionNotes: boolean
  allowDropIn: boolean
  dropInPriceCents: number | null
  allowWaitlist: boolean
  capacity: number | null
  publicEnrollment: boolean
  clientSelfBook: boolean
  /** True while this offering has a curriculum — see lib/series.ts. */
  isSeries: boolean
  /** The curriculum itself, in step order. Empty unless isSeries. */
  steps: { id: string; sessionIndex: number; title: string }[]
}

export type PackageClientRow = {
  id: string // ClientPackage id
  clientId: string
  clientName: string
  dogName: string | null
  dogPhotoUrl: string | null
  clientStatus: 'ACTIVE' | 'INACTIVE'
  startDate: string // ISO
  sessionsUsed: number
  sessionsTotal: number // 0 = ongoing/unlimited
  ongoing: boolean
  // Where this client has got to in the curriculum, on a series. Null on an
  // ordinary consult. Deliberately NOT derived from sessionsUsed: a client who
  // skipped step 2 is on step 4 after three sessions, and counting sessions
  // would confidently say step 3.
  stepIndex: number | null
  stepTitle: string | null
  stepsDone: number | null
  stepsTotal: number | null
  /** When the step they're up to happens. Null once nothing is left booked. */
  nextSessionAt: string | null
}

// Derive a client's standing on this package. "Completed" = a fixed-length
// package whose sessions are all done. Inactive client = past. Everything else
// counts as present/active.
function deriveStatus(row: PackageClientRow): { label: 'Active' | 'Completed' | 'Inactive'; present: boolean } {
  const completed = !row.ongoing && row.sessionsTotal > 0 && row.sessionsUsed >= row.sessionsTotal
  if (completed) return { label: 'Completed', present: false }
  if (row.clientStatus === 'INACTIVE') return { label: 'Inactive', present: false }
  return { label: 'Active', present: true }
}

const STATUS_BADGE: Record<'Active' | 'Completed' | 'Inactive', string> = {
  Active: 'bg-emerald-50 text-emerald-700',
  Completed: 'bg-slate-100 text-slate-600',
  Inactive: 'bg-amber-50 text-amber-700',
}

export function PackageDetail({ pkg, clients, currency }: { pkg: PackageInfo; clients: PackageClientRow[]; currency: string }) {
  const [tab, setTab] = useState<Tab>('details')
  // The Sessions tab's controls belong to the LIST. Inside one session they
  // are actions with nothing to act on, so the editor tells us which it is on.
  const [onSessionList, setOnSessionList] = useState(true)
  const [clientTab, setClientTab] = useState<'current' | 'past'>('current')

  const formatPrice = (cents: number | null): string =>
    cents === null || cents === undefined ? '—' : formatMoney(cents, currency)

  // One row per ASSIGNMENT — a client who buys the same package again holds two
  // of them, and both belong in the full roster (different start dates,
  // different sessions used).
  const rows = clients.map(c => ({ ...c, derived: deriveStatus(c) }))
  const present = rows.filter(r => r.derived.present)
  const past = rows.filter(r => !r.derived.present)

  // …but the Details-tab snapshot answers "who is on this package", so it's one
  // row per PERSON. Keyed by assignment it would list the same person twice;
  // keyed by client it collided the React key (two children with the same key),
  // which is how a row can silently vanish on re-render. Deduping fixes both.
  // Assignments arrive newest-first, so the row kept is their current one.
  const snapshot = Array.from(new Map(present.map(r => [r.clientId, r])).values()).slice(0, 6)

  // Driven by the pinned action bar rather than a button inside the tab — see
  // the `primary` prop below.
  const [pickingClient, setPickingClient] = useState(false)

  const effectivePrice = pkg.specialPriceCents ?? pkg.priceCents
  const totalRevenue = effectivePrice != null ? effectivePrice * rows.length : null
  const completedCount = rows.filter(r => r.derived.label === 'Completed').length
  const avgSessionsUsed = rows.length > 0 ? rows.reduce((s, r) => s + r.sessionsUsed, 0) / rows.length : 0

  const tabs: OfferingTab<Tab>[] = [
    { id: 'details', label: 'Details', icon: Info },
    { id: 'clients', label: 'Clients', icon: Users, badge: rows.length > 0 ? rows.length : undefined },
    // What each session covers and the homework that follows it — set once
    // here, confirmed in one tap on the session screen.
    //
    // Named for what the tab CONTAINS, not for what has been filled in yet: a
    // multi-session offering opens on a list of its sessions, so calling that
    // "Homework" hid it (found the hard way — the list was there and unfindable).
    // Only a single-session offering has nothing to list, and there it really is
    // just homework.
    {
      id: 'homework',
      label: pkg.sessionCount > 1 ? 'Sessions' : 'Homework',
      icon: ListChecks,
      badge: pkg.steps.length > 0 ? pkg.steps.length : undefined,
    },
    // 1:1 packages can send automated session reminders; group packages run
    // through their class page instead.
    ...(!pkg.isGroup ? [{ id: 'messages' as const, label: 'Automation', icon: Bell }] : []),
  ]

  // Edit, and everything occasional behind the ⋯ . Same hook the four screens
  // that still draw them inside a card use, so the routes, the confirmations
  // and the refusal prose have one copy between them.
  const { menu, editHref, error: actionError, overlays } = useOfferingActions({
    name: pkg.name,
    noun: pkg.isGroup ? 'class' : 'package',
    editHref: `/packages/${pkg.id}/edit`,
    packageId: pkg.id,
    backHref: '/packages',
  })

  return (
    <>
      {/* Name and the way back, nothing else. No subtitle — the session count
          was repeating what the Details card below already states. The actions
          are the pinned bar's below. */}
      <PageHeader
        title={pkg.name}
        back={{ href: '/packages', label: '1:1 Sessions' }}
      />

      {/* Full width — two columns of detail need the room, and capping it
          wastes half a wide monitor. Same shape as a class page. */}
      {/* min-w-0: the roster table carries a min-width so its columns stay
          legible; without this the flex chain up to <main> takes its automatic
          minimum size from the table and the whole PAGE scrolls sideways on a
          phone. Only the table's own overflow-x-auto should scroll. */}
      <div className="p-4 md:p-8 w-full min-w-0">
      {/* A read screen, on the same shell as an edit screen (Karl: "this should
          have the same view as product"). The search box and the bottom tabs go
          — you are looking at ONE offering — and the two controls that were
          floating inside the Details card become the pinned pair at the foot.
          There is no Cancel: nothing is being edited, and the way out is the
          back arrow the header already carries. */}
      <EditScreen
        menu={menu}
        menuTitle={pkg.name}
        // The action follows the TAB. "Edit" is right on Details — it's the
        // package you're looking at — but on Clients it offered to edit the
        // package while you were looking at who's on it, and on Sessions the
        // same (Karl: "this tab should not have edit, it should have add to
        // enrol the client" / "the sessions tab should have an add button").
        // Editing the package is still one tap away in the ⋯ on those tabs.
        primary={
          tab === 'clients'
            ? { label: 'Add', icon: <Plus className="h-4 w-4" strokeWidth={2} />, onClick: () => setPickingClient(true) }
              // Automation has none. Every step carries its own controls and
              // each stage its own "Add step", so the only screen-level action
              // left was Edit — which offered to edit the PACKAGE while you
              // were building its flow (Karl). It's still in the ⋯ .
              : tab === 'messages'
                ? undefined
                : { label: 'Edit', href: editHref, icon: <Pencil className="h-4 w-4" strokeWidth={1.75} /> }
        }
      >
        {actionError && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{actionError}</p>
        )}
        {overlays}

        {pickingClient && (
          <ClientPicker
            packageName={pkg.name}
            onClose={() => setPickingClient(false)}
          />
        )}

        {/* Tabs — Details, Clients, Automation. Icon on top on a
            phone (the labels are too long to sit beside one at 390px).

            The tab's own actions sit on the SAME line, at the right, the way
            every other screen in the app puts them. "Add a session" under the
            list meant scrolling past every session to reach it. */}
        {/* The strip gets the whole width on a phone. Sharing the line with
            the Sessions tab's own controls squeezed it to 239px, and four
            labels in 239px clip inside their own columns. */}
        {/* Sticky (Karl), the same offset the schedule bar and the product tabs
            use: under the shell's phone header, under the fixed top bar on
            desktop. The Clients and Sessions lists are both longer than a
            phone, and switching tab meant scrolling back up to find the
            switch. bg-white because the list scrolls UNDER it. */}
        {/* Edge to edge, like every other tab strip in the app (Karl: "tabs are
            not going full width" — both arrows in his screenshot were the gaps
            at the sides). The page wrapper is p-4 md:p-8, so the negative
            margins break out of it and the matching padding puts the tab text
            back in line with the content beneath. Without this the white
            background and the hairline both stop short of the page edges,
            which is what made this strip look unlike the others.
            -mt-6 eats EditScreen's gap above, so it meets the bar rather than
            floating below it; -mb-2 does the same underneath. */}
        <div className="max-md:sticky max-md:top-[calc(env(safe-area-inset-top,0px)+3.5rem+1px)] z-20 max-md:-mx-4 max-md:-mt-6 max-md:-mb-2 flex flex-col gap-3 bg-white max-md:px-4 pt-2 md:pt-0 md:-mt-2 sm:flex-row sm:items-end sm:justify-between">
          {/* flex-1: the strip takes the whole row like every other tab strip
              in the app (Karl: "tabs are not going full width"). It was
              content-width, so on a wide screen it stopped short of the page
              and its hairline stopped with it. */}
          <OfferingTabs tabs={tabs} value={tab} onChange={setTab} className="mb-0 min-w-0 flex-1" />
        </div>

        {/* Details tab: package info (left, 7 of 12) + a compact clients
            snapshot (right, 5). Same 7/5 split as the membership builder, so
            the detail screens read the same width-for-width. The full roster
            lives under the Clients tab. */}
        <div className={tab === 'details' ? 'grid grid-cols-1 lg:grid-cols-12 gap-5 items-start' : 'hidden'}>

          <div className={`lg:col-span-7 flex flex-col gap-5`}>

            {pkg.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pkg.imageUrl} alt={pkg.name} className="w-full h-40 sm:h-52 object-cover rounded-2xl border border-slate-200" />
            )}

            {/* Package details */}
            <Card>
              <CardBody className="py-5">
                {/* Edit and More used to float here, inside the card. They are
                    the screen's actions, not the card's — pinned to the foot of
                    it now, where they are on every other screen (Karl: "this
                    should have the same view as product"). */}
                {/* DESKTOP ONLY: the heading, with Edit and the ⋯ on it —
                    where they were before today (Karl: "show the h1 and put
                    the edit and the ... button like it was").
                    On a phone it stays hidden: the tab directly above already
                    says Details, and the actions are pinned to the foot, so
                    drawing this too would say the same thing twice in a place
                    that has no room for it. */}
                <div className="hidden md:block">
                  <CardHeading
                    icon={<Info className="h-4 w-4 text-slate-400" />}
                    action={
                      <OfferingActions
                        name={pkg.name}
                        noun={pkg.isGroup ? 'class' : 'package'}
                        editHref={`/packages/${pkg.id}/edit`}
                        packageId={pkg.id}
                        backHref="/packages"
                      />
                    }
                  >
                    Details
                  </CardHeading>
                </div>
                <div className="divide-y divide-slate-100">
                  <Detail label="Type" value={pkg.isGroup ? 'Group class' : '1:1'} />
                  <Detail label="Sessions" value={pkg.sessionCount === 0 ? 'Ongoing' : String(pkg.sessionCount)} />
                  <Detail
                    label="Spacing"
                    value={pkg.weeksBetween === 0 ? 'No spacing' : `Every ${pkg.weeksBetween} week${pkg.weeksBetween > 1 ? 's' : ''}`}
                  />
                  <Detail label="Length" value={`${pkg.durationMins} min`} />
                  <Detail label="Gap after" value={pkg.bufferMins > 0 ? `${pkg.bufferMins} min` : 'None'} />
                  <Detail label="Format" value={pkg.sessionType === 'VIRTUAL' ? 'Virtual' : 'In person'} />
                  {/* A waitlist isn't group-only — a 1:1 package that's full
                      can keep one too, so it reads on every package. */}
                  <Detail label="Waitlist" value={pkg.allowWaitlist ? 'Enabled' : 'Off'} />
                  <Detail label="Self-booking" value={pkg.clientSelfBook ? 'Clients can book this' : 'Off'} />
                  <Detail label="Session notes" value={pkg.requireSessionNotes ? 'Reminders on' : 'Reminders off'} />
                  {/* Price and revenue read together — what one client pays,
                      and what the package has sold — so they share a row. */}
                  <DetailPair
                    label="Price" value={formatPrice(pkg.priceCents)}
                    label2="Revenue" value2={totalRevenue != null ? formatPrice(totalRevenue) : '—'}
                  />
                  {pkg.specialPriceCents != null && (
                    <Detail label="Special price" value={formatPrice(pkg.specialPriceCents)} />
                  )}
                </div>

                {/* The description is what clients are sent when they're
                    assigned this, so it's worth seeing here rather than only in
                    the edit form. */}
                {!isRichTextEmpty(pkg.description) && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">About this package</p>
                    <RichText html={pkg.description} className="text-sm text-slate-600 leading-relaxed" />
                  </div>
                )}

                {/* The Edit and Delete rows that used to close this card are
                    gone: Edit was ~500px below the Edit in the card heading, so
                    the same action appeared twice on one screen. Both now live
                    once, at the top right — Edit as a button, Delete inside
                    More, still red and still asking first. */}
              </CardBody>
            </Card>

            {/* Class-only settings, kept as their own card so the details card
                above reads the same on every package. */}
            {pkg.isGroup && (
              <Card>
                <CardBody className="py-5">
                  <CardHeading icon={<Users className="h-4 w-4 text-slate-400" />}>Class settings</CardHeading>
                  <div className="divide-y divide-slate-100">
                    <Detail label="Capacity" value={pkg.capacity != null ? String(pkg.capacity) : 'Unlimited'} />
                    <Detail label="Drop-ins" value={pkg.allowDropIn ? 'Allowed' : 'No'} />
                    {pkg.allowDropIn && <Detail label="Drop-in price" value={formatPrice(pkg.dropInPriceCents)} />}
                    <Detail label="Public enrolment" value={pkg.publicEnrollment ? 'On' : 'Off'} />
                  </div>
                </CardBody>
              </Card>
            )}

            {/* How the package is actually selling. Sits under the details it
                describes rather than over the client list. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Clients" value={String(rows.length)} />
              <Stat label="Active now" value={String(present.length)} />
              <Stat label="Completed" value={String(completedCount)} />
              <Stat label="Avg sessions" value={avgSessionsUsed.toFixed(1)} />
            </div>
          </div>

          {/* Compact clients snapshot — the "small version" on the Details tab. */}
          <div className="lg:col-span-5 flex flex-col gap-5">
            <Card>
              <CardBody className="py-5">
                <CardHeading icon={<Users className="h-4 w-4 text-slate-400" />} count={rows.length}>Clients</CardHeading>
                {present.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4 text-center">No one on this package yet.</p>
                ) : (
                  <>
                    <ul className="divide-y divide-slate-100">
                      {snapshot.map(r => (
                        <ClientSnapshotRow
                          key={r.clientId}
                          clientId={r.clientId}
                          clientName={r.clientName}
                          dogName={r.dogName}
                          dogPhotoUrl={r.dogPhotoUrl}
                        />
                      ))}
                    </ul>
                    {rows.length > snapshot.length && (
                      <button type="button" onClick={() => setTab('clients')} className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700">View all {rows.length} →</button>
                    )}
                  </>
                )}
              </CardBody>
            </Card>
          </div>
        </div>

        {/* Clients tab — the full roster (current / past).
            No card around it, and no "Clients" heading inside: the tab you are
            standing on already says which is which, and a card drawn around
            the only thing on a tab is a border that separates it from nothing.
            The roster is the tab. */}
        <div className={`flex min-w-0 flex-col gap-5 ${tab === 'clients' ? '' : 'hidden'}`}>
                {rows.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white py-10 text-center text-slate-400">
                    <PackageIcon className="h-10 w-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No one has been assigned this package yet.</p>
                  </div>
                ) : (
                  <>
                    {/* Current / past as tabs rather than two stacked tables —
                        a long history shouldn't push who's actually on the
                        package off the bottom.

                        Flat text tabs on one hairline that runs the full width,
                        not a pill track. The pill was a short island with a
                        wide band of nothing beside it whichever end it was
                        pinned to; the rule reaches the table's top edge, so the
                        filter and the thing it filters read as one object. Same
                        shape as the class roster. */}
                    <div className="mb-3 flex gap-5 border-b border-slate-200">
                      {([
                        { id: 'current' as const, label: 'Current', count: present.length },
                        { id: 'past' as const, label: 'Past', count: past.length },
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
                      present.length > 0
                        ? <ClientTable rows={present} series={pkg.isSeries} />
                        : <p className="text-sm text-slate-500 py-4 text-center">No one on this package right now.</p>
                    ) : (
                      past.length > 0
                        ? <ClientTable rows={past} series={pkg.isSeries} />
                        : <p className="text-sm text-slate-500 py-4 text-center">No past clients.</p>
                    )}
                  </>
                )}
          </div>

        {/* Curriculum tab — what each session covers and the homework that
            follows it. One editor, not two: `SeriesCurriculumEditor` renders
            the homework editor with a plan field over each session's bucket, so
            a 1:1 session with no steps named looks exactly as it did before.

            Full width, not max-w-2xl: a session's plan and its homework sit
            side by side once there is room, and capping the column at 42rem
            left two thirds of a desktop screen empty beside a form the trainer
            was scrolling. */}
        <div className={tab === 'homework' ? '' : 'hidden'}>
        {/* A heading per tab on desktop (Karl). The Details card carries its
            own; these name the other panels so a wide screen isn't a slab of
            content with only a tab to say what it is. An <h2>, not an <h1>:
            the shell's top bar already renders the page's one h1 (the
            offering's name), and a second would be two on the page.
            Phone hides them — the tab strip is right there and the room is
            better spent on content. */}
          {/* Heading and Add share ONE row (Karl: "make these line up") — the
              heading was on its own line with the button dropped below it.
              Add sits directly above the list it adds to; it was the pinned
              primary, and a button at the top of the thing it affects is
              easier to find than one at the foot of a screen you've scrolled.
              It's hidden while you're inside a single session — nothing to add
              to there — and the row still holds its shape because the heading
              is the other half of it. */}
          <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
            <h2 className="hidden text-base font-semibold text-slate-900 md:block">
              {pkg.sessionCount > 1 ? 'Sessions' : 'Homework'}
            </h2>
            {onSessionList && <AddSessionButton packageId={pkg.id} sessionCount={pkg.sessionCount} />}
          </div>
          <SeriesCurriculumEditor
            packageId={pkg.id}
            sessionCount={pkg.sessionCount}
            isGroup={pkg.isGroup}
            onViewingListChange={setOnSessionList}
          />
        </div>

        {/* Automation tab — what this offering does on its own (1:1 only). */}
        {!pkg.isGroup && (
          <div className={tab === 'messages' ? '' : 'hidden'}>
            {/* Heading left, the flow's own action right — "Use starter
                reminders" portals into this slot (see HeaderSlot in the
                editor). It was at the foot of the card, below every stage. */}
            <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
              <h2 className="hidden text-base font-semibold text-slate-900 md:block">Automation</h2>
              <div id="flow-header-actions" className="ml-auto flex items-center gap-2 empty:hidden" />
            </div>
            <CommsFlowEditor
              packageId={pkg.id}
              offeringName={pkg.name}
              clients={Array.from(new Map(clients.map(c => [c.clientId, { id: c.clientId, name: c.clientName, dog: c.dogName }])).values())}
            />
          </div>
        )}

        {/* Discounts tab — the system-wide engine, attached to this package.
            Hidden for now (see the Tab type); restore the tab entry and this
            panel together. */}
      </EditScreen>
      </div>
    </>
  )
}

function ClientTable({
  rows,
  // On a SERIES the roster answers a different question — not "how many
  // sessions has this one had" but "where is each of them up to", which on a
  // consult series is the only place it can be answered at all: there is no
  // cohort, so each client is at their own step. Two extra columns on the same
  // table, rather than a second roster to keep in step with this one.
  series = false,
}: {
  rows: (PackageClientRow & { derived: ReturnType<typeof deriveStatus> })[]
  series?: boolean
}) {
  // Clicking anywhere on a row opens that client — the message cell stops the
  // event so it doesn't do both.
  const router = useRouter()
  return (
    // A real data table: a bordered surface with its own header band, the
    // client column taking the slack so the rest stay tight rather than
    // drifting apart across a wide screen. Matches the class roster.
    //
    // It carries its OWN white. It used to sit inside a Card and inherit one;
    // without the card the rows were the page's grey showing through, which
    // read as a table that had failed to load.
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[38rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <th className="w-full px-3 py-2 font-semibold">Client</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">Dog</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">Status</th>
            {series && <th className="whitespace-nowrap px-3 py-2 font-semibold">Up to</th>}
            <th className="whitespace-nowrap px-3 py-2 font-semibold">Sessions</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">{series ? 'Next' : 'Started'}</th>
            <th className="w-9 px-3 py-2"><span className="sr-only">Message</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(r => (
            <tr
              key={r.id}
              onClick={() => router.push(`/clients/${r.clientId}`)}
              className="cursor-pointer align-middle hover:bg-slate-50"
            >
              <td className="px-3 py-2.5">
                <Link href={`/clients/${r.clientId}`} className="flex items-center gap-2.5 group">
                  <ClientAvatar name={r.clientName} dogPhotoUrl={r.dogPhotoUrl} size="sm" />
                  <span className="font-medium text-slate-900 group-hover:text-blue-600 truncate">{r.clientName}</span>
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{r.dogName ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[r.derived.label]}`}>
                  {r.derived.label}
                </span>
              </td>
              {series && (
                <td className="whitespace-nowrap px-3 py-2.5">
                  {r.stepIndex != null ? (
                    <>
                      <span className="font-medium text-slate-800">Step {r.stepIndex}</span>
                      {r.stepsTotal ? <span className="text-slate-400"> of {r.stepsTotal}</span> : null}
                      {r.stepTitle && <span className="block text-xs text-slate-500">{r.stepTitle}</span>}
                    </>
                  ) : (
                    // No step left to cover: either every session has happened,
                    // or they've run past the end of the curriculum. Both mean
                    // "nothing further planned", which is worth saying plainly
                    // rather than showing an empty cell.
                    <span className="text-slate-400">
                      {r.stepsDone != null && r.stepsTotal ? `Finished · ${r.stepsDone} of ${r.stepsTotal}` : '—'}
                    </span>
                  )}
                </td>
              )}
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 tabular-nums">
                {r.sessionsUsed}{r.sessionsTotal > 0 ? ` / ${r.sessionsTotal}` : ''}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-500" suppressHydrationWarning>
                {series
                  ? (r.nextSessionAt ? new Date(r.nextSessionAt).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : '—')
                  : new Date(r.startDate).toLocaleDateString()}
              </td>
              <td className="px-3 py-2.5">
                <Link
                  href={`/messages?client=${r.clientId}`}
                  onClick={e => e.stopPropagation()}
                  aria-label={`Message ${r.clientName}`}
                  title={`Message ${r.clientName}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                >
                  <MessageSquare className="h-4 w-4" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Two facts on one row, each keeping the label-left shape. */
function DetailPair({
  label, value, label2, value2,
}: { label: string; value: string; label2: string; value2: string }) {
  return (
    <div className="flex flex-col gap-2.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:gap-4">
      <div className="flex flex-1 items-baseline gap-4">
        <p className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="min-w-0 flex-1 text-sm font-medium text-slate-800">{value}</p>
      </div>
      <div className="flex flex-1 items-baseline gap-4">
        <p className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:w-auto">{label2}</p>
        <p className="min-w-0 flex-1 text-sm font-medium text-slate-800">{value2}</p>
      </div>
    </div>
  )
}

/** One fact about the package: label on the left, value beside it — the same
 *  shape as a class page, and it never truncates the value. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-4 py-2.5 first:pt-0 last:pb-0">
      <p className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="min-w-0 flex-1 text-sm font-medium text-slate-800" suppressHydrationWarning>{value}</p>
    </div>
  )
}

/**
 * "Who are you enrolling?" — the missing half of enrolling from THIS side.
 *
 * Assigning has always started from a client (their Sessions screen), because
 * the flow needs their dogs, their availability, their trainer and their
 * invoicing — none of which this page loads. So this doesn't try to assign:
 * it asks who, and hands over to the screen that can, with the assign sheet
 * already open. One flow, one place it lives, reachable from both ends.
 */
function ClientPicker({ packageName, onClose }: { packageName: string; onClose: () => void }) {
  const router = useRouter()
  const [items, setItems] = useState<{ id: string; name: string | null; dogName: string | null }[] | null>(null)
  const [q, setQ] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/clients')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then(d => { if (live) setItems(d.items ?? []) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [])

  const shown = (items ?? []).filter(c =>
    !q.trim() || `${c.name ?? ''} ${c.dogName ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()),
  )

  return (
    <FullScreenSheet
      title="Enrol a client"
      sub={packageName}
      onClose={onClose}
      headerExtra={
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search clients…"
          className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
      }
    >
      {failed ? (
        <p className="px-4 py-8 text-center text-sm text-red-600">Could not load your clients.</p>
      ) : items === null ? (
        <p className="px-4 py-8 text-center text-sm text-slate-500">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-500">
          {q.trim() ? 'No client matches that.' : 'No clients yet.'}
        </p>
      ) : (
        <FlatBlock>
          {shown.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => router.push(`/clients/${c.id}/sessions?assign=1`)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-slate-900">{c.name ?? 'Unnamed'}</span>
                {c.dogName && <span className="block truncate text-[13px] text-slate-500">{c.dogName}</span>}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
            </button>
          ))}
        </FlatBlock>
      )}
    </FullScreenSheet>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody className="py-3 px-4">
        <p className="text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
        <p className="text-xs text-slate-500 mt-0.5">{label}</p>
      </CardBody>
    </Card>
  )
}
