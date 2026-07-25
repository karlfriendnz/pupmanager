import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { getEnabledAddons } from '@/lib/billing'
import { ONE_OFF_EVENT_PACKAGE } from '@/lib/class-runs'
import {
  Package, GraduationCap, Ticket, CalendarPlus, Dog, ShoppingBag, Layers, ChevronRight,
} from 'lucide-react'
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
  const rows = [
    { href: '/packages', label: '1:1 Packages', icon: Package, count: packages, one: 'package', many: 'packages', on: true },
    { href: '/classes', label: 'Group Classes', icon: GraduationCap, count: classes, one: 'class', many: 'classes', on: addons.has('classes') },
    { href: '/casual-classes', label: 'Casual Classes', icon: Ticket, count: casual, one: 'class', many: 'classes', on: addons.has('dropins') },
    { href: '/events', label: 'Events', icon: CalendarPlus, count: events, one: 'event', many: 'events', on: addons.has('events') },
    { href: '/doggy-daycare', label: 'Doggy Daycare', icon: Dog, count: daycare, one: 'programme', many: 'programmes', on: addons.has('puppyschool') },
    { href: '/memberships', label: 'Memberships', icon: Ticket, count: memberships, one: 'membership', many: 'memberships', on: addons.has('memberships') },
    { href: '/products', label: 'Products', icon: ShoppingBag, count: products, one: 'product', many: 'products', on: addons.has('shop') },
    { href: '/templates', label: 'Library', icon: Layers, count: null, one: '', many: '', on: true },
  ].filter(r => r.on)

  return (
    <>
      <PageHeader title="Offerings" />
      <div className="p-4 md:p-8 w-full md:max-w-2xl">
        {/* One block, hairline-divided — not a stack of floating cards with
            tinted icon chips. Matches the phone home. */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
          {rows.map(r => {
            const Icon = r.icon
            return (
              <Link
                key={r.href}
                href={r.href}
                className="flex items-center gap-3.5 px-4 py-4 active:bg-slate-50 hover:bg-slate-50"
              >
                <Icon className="h-[22px] w-[22px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold leading-tight text-slate-900">{r.label}</span>
                  <span className="mt-0.5 block text-[13px] text-slate-500">
                    {r.count === null
                      ? 'Session plans & templates'
                      : r.count === 0
                        ? `No ${r.many} yet — tap to create one`
                        : `${r.count} ${r.count === 1 ? r.one : r.many}`}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
              </Link>
            )
          })}
        </div>
      </div>
    </>
  )
}
