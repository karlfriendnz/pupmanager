'use client'

import { useState } from 'react'
import { RichText } from '@/components/shared/rich-text'
import { isRichTextEmpty } from '@/lib/rich-text'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardBody } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/page-header'
import { ClientAvatar } from '@/components/shared/client-avatar'
import { ClientSnapshotRow } from '@/components/shared/client-snapshot-row'
import { CardHeading } from '@/components/shared/card-heading'
import { OfferingActions } from '@/components/trainer/offering-actions'
import { Info, Users, Package as PackageIcon, Bell, MessageSquare, ListChecks } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { CommsFlowEditor } from '@/components/trainer/comms-flow-editor'
import { DefaultHomeworkEditor } from '@/components/trainer/default-homework-editor'
import { OfferingTabs, type OfferingTab } from '@/components/shared/offering-tabs'

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

  const effectivePrice = pkg.specialPriceCents ?? pkg.priceCents
  const totalRevenue = effectivePrice != null ? effectivePrice * rows.length : null
  const completedCount = rows.filter(r => r.derived.label === 'Completed').length
  const avgSessionsUsed = rows.length > 0 ? rows.reduce((s, r) => s + r.sessionsUsed, 0) / rows.length : 0

  const tabs: OfferingTab<Tab>[] = [
    { id: 'details', label: 'Details', icon: Info },
    { id: 'clients', label: 'Clients', icon: Users, badge: rows.length > 0 ? rows.length : undefined },
    // The homework this offering normally hands out — set once here, confirmed
    // in one tap on the session screen.
    { id: 'homework', label: 'Homework', icon: ListChecks },
    // 1:1 packages can send automated session reminders; group packages run
    // through their class page instead.
    ...(!pkg.isGroup ? [{ id: 'messages' as const, label: 'Reminders & messages', icon: Bell }] : []),
  ]

  return (
    <>
      {/* Name and the way back, nothing else. No subtitle — the session count
          was repeating what the Details card below already states — and no
          actions: Edit and Delete are things you do to THIS offering, so they
          live on the page with it, at the end of the Details card. */}
      <PageHeader
        title={pkg.name}
        back={{ href: '/packages', label: '1:1 Consults' }}
      />

      {/* Full width — two columns of detail need the room, and capping it
          wastes half a wide monitor. Same shape as a class page. */}
      {/* min-w-0: the roster table carries a min-width so its columns stay
          legible; without this the flex chain up to <main> takes its automatic
          minimum size from the table and the whole PAGE scrolls sideways on a
          phone. Only the table's own overflow-x-auto should scroll. */}
      <div className="p-4 md:p-8 w-full min-w-0">

        {/* Tabs — Details, Clients, Reminders & messages. Icon on top on a
            phone (the labels are too long to sit beside one at 390px). */}
        <OfferingTabs tabs={tabs} value={tab} onChange={setTab} />

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
                {/* Edit sits here, at the top of what it edits — one tap, no
                    scrolling to the foot of the card to find it. Everything
                    occasional (duplicate, convert, delete) is behind More. */}
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

        {/* Clients tab — the full roster (current / past). */}
        <div className={`flex min-w-0 flex-col gap-5 ${tab === 'clients' ? '' : 'hidden'}`}>

            <Card>
              <CardBody className="py-5">
                <CardHeading icon={<Users className="h-4 w-4 text-slate-400" />} count={rows.length}>
                  Clients
                </CardHeading>

                {rows.length === 0 ? (
                  <div className="py-10 text-center text-slate-400">
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
                        ? <ClientTable rows={present} />
                        : <p className="text-sm text-slate-500 py-4 text-center">No one on this package right now.</p>
                    ) : (
                      past.length > 0
                        ? <ClientTable rows={past} />
                        : <p className="text-sm text-slate-500 py-4 text-center">No past clients.</p>
                    )}
                  </>
                )}
              </CardBody>
            </Card>
          </div>

        {/* Homework tab — the default tasks this offering suggests, per session. */}
        <div className={tab === 'homework' ? 'max-w-2xl' : 'hidden'}>
          <DefaultHomeworkEditor packageId={pkg.id} sessionCount={pkg.sessionCount} />
        </div>

        {/* Reminders & messages tab — automated session reminders (1:1 only). */}
        {!pkg.isGroup && (
          <div className={tab === 'messages' ? '' : 'hidden'}>
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
      </div>
    </>
  )
}

function ClientTable({
  rows,
}: {
  rows: (PackageClientRow & { derived: ReturnType<typeof deriveStatus> })[]
}) {
  // Clicking anywhere on a row opens that client — the message cell stops the
  // event so it doesn't do both.
  const router = useRouter()
  return (
    // A real data table: a bordered surface with its own header band, the
    // client column taking the slack so the rest stay tight rather than
    // drifting apart across a wide screen. Matches the class roster.
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[38rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <th className="w-full px-3 py-2 font-semibold">Client</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">Dog</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">Status</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">Sessions</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">Started</th>
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
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 tabular-nums">
                {r.sessionsUsed}{r.sessionsTotal > 0 ? ` / ${r.sessionsTotal}` : ''}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-500" suppressHydrationWarning>
                {new Date(r.startDate).toLocaleDateString()}
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
