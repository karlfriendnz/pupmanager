import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { todayInTz } from '@/lib/timezone'
import { RouteManager } from './route-manager'

export const metadata: Metadata = { title: 'Route' }

export default async function RoutePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  // Route planner is a paid add-on.
  if (!(await hasAddon(ctx.companyId, 'routeplanner'))) redirect('/settings?tab=addons')

  const profile = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: { baseAddress: true, baseLat: true, baseLng: true, user: { select: { timezone: true } } },
  })
  const tz = profile?.user.timezone ?? 'Pacific/Auckland'
  // Honour ?date=YYYY-MM-DD (e.g. clicked from the schedule); default to today.
  const sp = await searchParams
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayInTz(tz)

  // Day stops are fetched client-side (driven by the URL ?date), so the page
  // itself stays light — just base + members.
  const memberRows = await prisma.trainerMembership.findMany({
    where: { companyId: ctx.companyId },
    select: { id: true, user: { select: { name: true, email: true } } },
    orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }],
  })

  const base = profile?.baseLat != null && profile?.baseLng != null
    ? { address: profile.baseAddress, lat: profile.baseLat, lng: profile.baseLng }
    : null
  const members = memberRows.map(m => ({ id: m.id, name: m.user.name ?? m.user.email }))

  return (
    <div>
      <h1 className="text-xl font-bold mb-3">Route</h1>
      <Suspense fallback={<p className="text-sm text-slate-400">Loading route…</p>}>
        <RouteManager base={base} clients={[]} members={members} initialDate={date} />
      </Suspense>
    </div>
  )
}
