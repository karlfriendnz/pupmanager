import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { getEnabledAddons } from '@/lib/billing'
import { ONE_OFF_EVENT_PACKAGE } from '@/lib/class-runs'
import { OfferingsList, type OfferingRowData } from './offerings-list'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Offerings' }

/**
 * One hub for everything a trainer sells.
 *
 * The six offering types each have their own page, which on a phone means six
 * near-identical entries buried in the "More" sheet. This gathers them behind
 * a single Offerings tile on the mobile home.
 *
 * Every count below reuses the exact `where` its own list page uses — if those
 * ever drift, the hub would quietly under- or over-report.
 */
export default async function OfferingsPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const addons = await getEnabledAddons(trainerId)

  const [packages, classes, casual, events, daycare, memberships, products] = await Promise.all([
    prisma.package.count({ where: { trainerId, isGroup: false } }),
    prisma.classRun.count({
      where: { trainerId, package: { allowDropIn: false }, NOT: { package: ONE_OFF_EVENT_PACKAGE } },
    }),
    prisma.classRun.count({ where: { trainerId, package: { allowDropIn: true, isPuppySchool: false } } }),
    prisma.classRun.count({ where: { trainerId, package: ONE_OFF_EVENT_PACKAGE } }),
    prisma.package.count({ where: { trainerId, isPuppySchool: true } }),
    prisma.membership.count({ where: { trainerId } }),
    prisma.product.count({ where: { trainerId } }),
  ])

  // Same gating as the nav: a type whose add-on is off simply isn't offered.
  // `icon` is a plain key, not a component — see offerings-list.tsx for why.
  const rows = [
    { href: '/packages', label: '1:1 Consults', icon: 'packages', count: packages, one: 'consult', many: 'consults', on: true },
    { href: '/classes', label: 'Group Classes', icon: 'classes', count: classes, one: 'class', many: 'classes', on: addons.has('classes') },
    { href: '/casual-classes', label: 'Casual Classes', icon: 'casual', count: casual, one: 'class', many: 'classes', on: addons.has('dropins') },
    { href: '/events', label: 'Events', icon: 'events', count: events, one: 'event', many: 'events', on: addons.has('events') },
    // Doggy Daycare is hidden for now (Karl, 2026-07-26), matching the nav —
    // the page still works, it just isn't offered. Restore `on` to
    // `addons.has('puppyschool')` to bring it back.
    { href: '/doggy-daycare', label: 'Doggy Daycare', icon: 'daycare', count: daycare, one: 'programme', many: 'programmes', on: false },
    { href: '/memberships', label: 'Packages', icon: 'memberships', count: memberships, one: 'package', many: 'packages', on: addons.has('memberships') },
    { href: '/products', label: 'Products', icon: 'products', count: products, one: 'product', many: 'products', on: addons.has('shop') },
    { href: '/library', label: 'Library', icon: 'library', count: null, one: '', many: '', on: true },
  ] as const

  const visible: OfferingRowData[] = rows
    .filter(r => r.on)
    .map(r => ({
      href: r.href,
      label: r.label,
      icon: r.icon,
      sub:
        r.count === null
          ? 'Session plans & templates'
          : r.count === 0
            ? `No ${r.many} yet — tap to create one`
            : `${r.count} ${r.count === 1 ? r.one : r.many}`,
    }))

  return (
    <>
      <PageHeader title="Offerings" />
      <div className="p-4 md:p-8 w-full md:max-w-2xl">
        <OfferingsList rows={visible} />
      </div>
    </>
  )
}
