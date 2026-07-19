'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { ClientAvatar } from '@/components/shared/client-avatar'
import { Info, Users, Pencil, Package as PackageIcon } from 'lucide-react'
import { formatMoney } from '@/lib/money'

type Tab = 'details' | 'clients'

export type PackageInfo = {
  id: string
  name: string
  description: string | null
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
  ]

  return (
    <>
      <PageHeader
        title={pkg.name}
        subtitle={pkg.sessionCount === 0 ? 'Ongoing package' : `${pkg.sessionCount} sessions`}
        back={{ href: '/packages', label: 'Packages' }}
        actions={
          <Link href={`/packages/${pkg.id}/edit`}>
            <Button size="sm" variant="secondary">
              <Pencil className="h-4 w-4" />
              <span className="hidden sm:inline">Edit package</span>
            </Button>
          </Link>
        }
      />

      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">
        {/* Tab bar */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl mb-6 max-w-xs">
          {tabs.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
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

        {tab === 'details' ? (
          <DetailsTab pkg={pkg} currency={currency} />
        ) : (
          <ClientsTab
            present={present}
            past={past}
            currency={currency}
            stats={{
              total: rows.length,
              active: present.length,
              completed: completedCount,
              totalRevenue,
              avgSessionsUsed,
            }}
          />
        )}
      </div>
    </>
  )
}

function DetailsTab({ pkg, currency }: { pkg: PackageInfo; currency: string }) {
  const formatPrice = (cents: number | null): string =>
    cents === null || cents === undefined ? '—' : formatMoney(cents, currency)
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardBody className="py-5">
          {pkg.description ? (
            <p className="text-sm text-slate-600 mb-5">{pkg.description}</p>
          ) : null}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <Detail label="Sessions" value={pkg.sessionCount === 0 ? 'Ongoing' : String(pkg.sessionCount)} />
            <Detail label="Spacing" value={pkg.weeksBetween === 0 ? 'No spacing' : `Every ${pkg.weeksBetween} week${pkg.weeksBetween > 1 ? 's' : ''}`} />
            <Detail label="Length" value={`${pkg.durationMins} min`} />
            <Detail label="Gap after" value={pkg.bufferMins > 0 ? `${pkg.bufferMins} min` : 'None'} />
            <Detail label="Format" value={pkg.sessionType === 'VIRTUAL' ? 'Virtual' : 'In person'} />
            <Detail label="Price" value={formatPrice(pkg.priceCents)} />
            {pkg.specialPriceCents != null && (
              <Detail label="Special price" value={formatPrice(pkg.specialPriceCents)} />
            )}
            <Detail label="Type" value={pkg.isGroup ? 'Group class' : '1:1'} />
            <Detail label="Session notes" value={pkg.requireSessionNotes ? 'Reminders on' : 'Reminders off'} />
          </div>

          {pkg.isGroup && (
            <div className="mt-5 pt-5 border-t border-slate-100">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-3">Class settings</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                <Detail label="Capacity" value={pkg.capacity != null ? String(pkg.capacity) : 'Unlimited'} />
                <Detail label="Drop-ins" value={pkg.allowDropIn ? 'Allowed' : 'No'} />
                {pkg.allowDropIn && <Detail label="Drop-in price" value={formatPrice(pkg.dropInPriceCents)} />}
                <Detail label="Waitlist" value={pkg.allowWaitlist ? 'Enabled' : 'Off'} />
                <Detail label="Public enrolment" value={pkg.publicEnrollment ? 'On' : 'Off'} />
              </div>
            </div>
          )}

          {pkg.clientSelfBook && (
            <p className="text-xs text-slate-400 mt-4">Clients can self-book sessions from this package.</p>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function ClientsTab({
  present,
  past,
  stats,
  currency,
}: {
  present: (PackageClientRow & { derived: ReturnType<typeof deriveStatus> })[]
  past: (PackageClientRow & { derived: ReturnType<typeof deriveStatus> })[]
  stats: { total: number; active: number; completed: number; totalRevenue: number | null; avgSessionsUsed: number }
  currency: string
}) {
  const formatPrice = (cents: number | null): string =>
    cents === null || cents === undefined ? '—' : formatMoney(cents, currency)
  return (
    <div className="flex flex-col gap-5">
      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Total clients" value={String(stats.total)} />
        <Stat label="Active now" value={String(stats.active)} />
        <Stat label="Completed" value={String(stats.completed)} />
        <Stat label="Revenue" value={stats.totalRevenue != null ? formatPrice(stats.totalRevenue) : '—'} />
        <Stat label="Avg sessions used" value={stats.avgSessionsUsed.toFixed(1)} />
      </div>

      {present.length + past.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center text-slate-400">
            <PackageIcon className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No one has been assigned this package yet.</p>
          </CardBody>
        </Card>
      ) : (
        <>
          {present.length > 0 && <ClientTable title="Current clients" rows={present} />}
          {past.length > 0 && <ClientTable title="Past clients" rows={past} />}
        </>
      )}
    </div>
  )
}

function ClientTable({
  title,
  rows,
}: {
  title: string
  rows: (PackageClientRow & { derived: ReturnType<typeof deriveStatus> })[]
}) {
  return (
    <Card>
      <CardBody className="py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1 px-1">{title} ({rows.length})</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="font-medium py-2 px-1">Client</th>
                <th className="font-medium py-2 px-1">Dog</th>
                <th className="font-medium py-2 px-1">Status</th>
                <th className="font-medium py-2 px-1">Sessions</th>
                <th className="font-medium py-2 px-1">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-800 mt-0.5 truncate">{value}</p>
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
