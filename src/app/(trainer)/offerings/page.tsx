import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { getEnabledAddons } from '@/lib/billing'
import { EVENT_PACKAGE, NON_EVENT_PACKAGE } from '@/lib/class-runs'
import { OfferingsList, type OfferingRowData } from './offerings-list'
import { labelFor, sanitizeNavLabels, type NavLabelKey } from '@/lib/nav-labels'
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

  const [packages, classes, casual, events, daycare, memberships, products, tags] = await Promise.all([
    prisma.package.count({ where: { trainerId, isGroup: false } }),
    prisma.classRun.count({
      where: { trainerId, package: { allowDropIn: false, ...NON_EVENT_PACKAGE } },
    }),
    prisma.classRun.count({ where: { trainerId, package: { allowDropIn: true, isPuppySchool: false, ...NON_EVENT_PACKAGE } } }),
    prisma.classRun.count({ where: { trainerId, package: EVENT_PACKAGE } }),
    prisma.package.count({ where: { trainerId, isPuppySchool: true } }),
    prisma.membership.count({ where: { trainerId } }),
    prisma.product.count({ where: { trainerId } }),
    prisma.tag.count({ where: { trainerId } }),
  ])

  // Same gating as the nav: a type whose add-on is off simply isn't offered.
  // `icon` is a plain key, not a component — see offerings-list.tsx for why.
  const rows = [
    { href: '/packages', label: '1:1 Sessions', icon: 'packages', count: packages, one: '1:1 session', many: '1:1 sessions', on: addons.has('onetoone') },
    { href: '/classes', label: 'Group Classes', icon: 'classes', count: classes, one: 'class', many: 'classes', on: addons.has('classes') },
    { href: '/casual-classes', label: 'Casual Classes', icon: 'casual', count: casual, one: 'class', many: 'classes', on: addons.has('dropins') },
    { href: '/events', label: 'Events', icon: 'events', count: events, one: 'event', many: 'events', on: addons.has('events') },
    // Hidden again (Karl, 2026-07-29), matching the nav — the page still works,
    // it just isn't offered while the feature is unfinished. Restore `on` to
    // `addons.has('puppyschool')` to bring it back.
    { href: '/doggy-daycare', label: 'Doggy Daycare', icon: 'daycare', count: daycare, one: 'programme', many: 'programmes', on: false },
    // Back on (Karl, 2026-07-29), matching the nav — gated on the add-on, which
    // is itself `hidden` so it is not advertised in prod.
    { href: '/memberships', label: 'Packages', icon: 'memberships', count: memberships, one: 'package', many: 'packages', on: addons.has('memberships') },
    { href: '/products', label: 'Products', icon: 'products', count: products, one: 'product', many: 'products', on: addons.has('shop') },
    { href: '/library', label: 'Library', icon: 'library', count: null, one: '', many: '', on: true },
    // Not a type of offering — a label that crosses ALL of them, which is why
    // it sits at the foot of the hub. One "Puppy" tag can hold a course, a 1:1
    // session and a product at the same time. The row stays because this is
    // where a trainer MEETS the idea; the screen it opens now lives in Settings
    // (Karl, 2026-08-06), so it links straight there rather than through the
    // /offerings/tags redirect.
    { href: '/settings?tab=tags', label: 'Tags', icon: 'tags', count: tags, one: 'tag', many: 'tags', on: true },
  ] as const

  // The trainer's own words for these, exactly as the left menu uses them.
  // This hub hard-coded "1:1 Sessions", "Group Classes", "Packages"… so a
  // trainer who renamed them in Settings saw their words in the menu and ours
  // here. It shows up on a PHONE (Karl) because there is no left menu there —
  // this hub IS how you reach these, so it's the only name you're given.
  // The catalog keys ARE these hrefs; anything not in it (Tags, which links to
  // a settings tab) falls through to the default.
  const navLabels = sanitizeNavLabels(
    (await prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { navLabels: true },
    }))?.navLabels,
  )

  const visible: OfferingRowData[] = rows
    .filter(r => r.on)
    .map(r => ({
      href: r.href,
      label: labelFor(r.href as NavLabelKey, r.label, navLabels),
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
