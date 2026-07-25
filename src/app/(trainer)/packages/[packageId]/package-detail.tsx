'use client'

import { useState } from 'react'
import { RichText } from '@/components/shared/rich-text'
import { isRichTextEmpty } from '@/lib/rich-text'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { ClientAvatar } from '@/components/shared/client-avatar'
import { ClientSnapshotRow } from '@/components/shared/client-snapshot-row'
import { CardHeading } from '@/components/shared/card-heading'
import { Info, Users, Pencil, Package as PackageIcon, Bell, Tag, MessageSquare } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { CommsFlowEditor } from '@/components/trainer/comms-flow-editor'
import { DiscountManager } from '@/components/trainer/discount-manager'

type Tab = 'details' | 'clients' | 'messages' | 'discounts'

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

  const rows = clients.map(c => ({ ...c, derived: deriveStatus(c) }))
  const present = rows.filter(r => r.derived.present)
  const past = rows.filter(r => !r.derived.present)

  const effectivePrice = pkg.specialPriceCents ?? pkg.priceCents
  const totalRevenue = effectivePrice != null ? effectivePrice * rows.length : null
  const completedCount = rows.filter(r => r.derived.label === 'Completed').length
  const avgSessionsUsed = rows.length > 0 ? rows.reduce((s, r) => s + r.sessionsUsed, 0) / rows.length : 0

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }[] = [
    { id: 'details', label: 'Details', icon: Info },
    { id: 'clients', label: 'Clients', icon: Users, badge: rows.length > 0 ? rows.length : undefined },
    // 1:1 packages can send automated session reminders; group packages run
    // through their class page instead.
    ...(!pkg.isGroup ? [{ id: 'messages' as const, label: 'Reminders & messages', icon: Bell }] : []),
    { id: 'discounts', label: 'Discounts', icon: Tag },
  ]

  return (
    <>
      {/* No subtitle: the session count was repeating what the Details card
          below already states, and the name reads better on its own. */}
      <PageHeader
        title={pkg.name}
        back={{ href: '/packages', label: 'Packages' }}
        actions={
          <Link href={`/packages/${pkg.id}/edit`}>
            <Button variant="secondary">
              <Pencil className="h-4 w-4" /> <span className="hidden sm:inline">Edit</span>
            </Button>
          </Link>
        }
      />

      {/* Full width — two columns of detail need the room, and capping it
          wastes half a wide monitor. Same shape as a class page. */}
      <div className="p-4 md:p-8 w-full">

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
                <CardHeading icon={<Info className="h-4 w-4 text-slate-400" />}>Details</CardHeading>
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
                      {present.slice(0, 6).map(r => (
                        <ClientSnapshotRow
                          key={r.clientId}
                          clientId={r.clientId}
                          clientName={r.clientName}
                          dogName={r.dogName}
                          dogPhotoUrl={r.dogPhotoUrl}
                        />
                      ))}
                    </ul>
                    {rows.length > 6 && (
                      <button type="button" onClick={() => setTab('clients')} className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700">View all {rows.length} →</button>
                    )}
                  </>
                )}
              </CardBody>
            </Card>
          </div>
        </div>

        {/* Clients tab — the full roster (current / past). */}
        <div className={`flex flex-col gap-5 ${tab === 'clients' ? '' : 'hidden'}`}>

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
                        package off the bottom. */}
                    <div className="mb-3 inline-flex gap-1 rounded-2xl bg-slate-100 p-1.5">
                      {([
                        { id: 'current' as const, label: 'Current', count: present.length },
                        { id: 'past' as const, label: 'Past', count: past.length },
                      ]).map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setClientTab(t.id)}
                          aria-pressed={clientTab === t.id}
                          className={`inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm font-medium transition-all ${
                            clientTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          {t.label}
                          <span className={`min-w-4 rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                            clientTab === t.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                          }`}>
                            {t.count}
                          </span>
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

        {/* Reminders & messages tab — automated session reminders (1:1 only). */}
        {!pkg.isGroup && (
          <div className={tab === 'messages' ? '' : 'hidden'}>
            <CommsFlowEditor
              packageId={pkg.id}
              clients={Array.from(new Map(clients.map(c => [c.clientId, { id: c.clientId, name: c.clientName }])).values())}
            />
          </div>
        )}

        {/* Discounts tab — the system-wide engine, attached to this package. */}
        <div className={tab === 'discounts' ? '' : 'hidden'}>
          <DiscountManager packageId={pkg.id} />
        </div>
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
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
            <th className="font-medium py-2 px-1">Client</th>
            <th className="font-medium py-2 px-1">Dog</th>
            <th className="font-medium py-2 px-1">Status</th>
            <th className="font-medium py-2 px-1">Sessions</th>
            <th className="font-medium py-2 px-1">Started</th>
            <th className="font-medium py-2 px-1 w-9"><span className="sr-only">Message</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map(r => (
            <tr
              key={r.id}
              onClick={() => router.push(`/clients/${r.clientId}`)}
              className="cursor-pointer hover:bg-slate-50"
            >
              <td className="py-2.5 px-1">
                <Link href={`/clients/${r.clientId}`} className="flex items-center gap-2.5 group">
                  <ClientAvatar name={r.clientName} dogPhotoUrl={r.dogPhotoUrl} size="sm" />
                  <span className="font-medium text-slate-900 group-hover:text-blue-600 truncate">{r.clientName}</span>
                </Link>
              </td>
              <td className="py-2.5 px-1 text-slate-600">{r.dogName ?? '—'}</td>
              <td className="py-2.5 px-1">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[r.derived.label]}`}>
                  {r.derived.label}
                </span>
              </td>
              <td className="py-2.5 px-1 text-slate-600 tabular-nums">
                {r.sessionsUsed}{r.sessionsTotal > 0 ? ` / ${r.sessionsTotal}` : ''}
              </td>
              <td className="py-2.5 px-1 text-slate-500 whitespace-nowrap" suppressHydrationWarning>
                {new Date(r.startDate).toLocaleDateString()}
              </td>
              <td className="py-2.5 px-1">
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
