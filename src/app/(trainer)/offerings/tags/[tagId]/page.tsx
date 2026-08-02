import { redirect, notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { runKind } from '@/lib/run-kind'
import { TagDetail, type TaggedItem } from './tag-detail'

export const metadata: Metadata = { title: 'Tag' }

/**
 * What is in one tag — offerings AND products, on ONE screen.
 *
 * This is the whole reason a tag exists here. "Puppy" is the trainer's answer
 * to "I've just got a puppy", and that answer is a course AND a 1:1 AND the
 * clicker in their shop. The client's browse screen already made exactly this
 * call (my-availability/booking-wizard.tsx: "ONE MIXED SCREEN, not a filter per
 * list"), so the trainer's view of the same tag is sectioned the same way and
 * uses the same words — otherwise the two ends describe one tag differently and
 * a trainer can't tell what a client will see.
 *
 * TENANT SCOPING IS DOUBLE-ENDED. The tag id is re-read against the signed-in
 * business first — another trainer's id is a 404, not an empty screen — and the
 * items are then read from the PACKAGE and PRODUCT ends, each scoped to
 * trainerId in its own `where`. Reaching them through the tag's assignments
 * alone would have been enough (a tag belongs to one trainer), but the second
 * end costs nothing and means neither check is load-bearing on its own.
 */
export default async function TagPage({ params }: { params: Promise<{ tagId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const { tagId } = await params

  const tag = await prisma.tag.findFirst({
    where: { id: tagId, trainerId },
    select: { id: true, name: true },
  })
  if (!tag) notFound()

  const [packages, products] = await Promise.all([
    prisma.package.findMany({
      where: { trainerId, tags: { some: { tagId: tag.id } } },
      // The trainer's own arranged order, the same one their offering lists and
      // their clients' booking screen read.
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true, name: true, priceCents: true, specialPriceCents: true,
        durationMins: true, sessionCount: true,
        // Everything runKind() needs to tell the five kinds apart, plus isGroup
        // — a 1:1 package has no run at all. Read, never inferred from shape:
        // see lib/run-kind.ts for what inferring it cost last time.
        isGroup: true, isEvent: true, isPuppySchool: true, allowDropIn: true, isSeries: true,
      },
    }),
    prisma.product.findMany({
      where: { trainerId, tags: { some: { tagId: tag.id } } },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, name: true, priceCents: true, salePriceCents: true, active: true },
    }),
  ])

  const offerings: TaggedItem[] = packages.map(p => ({
    // Namespaced, because a package id and a product id are only unique within
    // their own table and this list mixes them.
    key: `package:${p.id}`,
    target: { packageId: p.id },
    // A SERIES is not its own section: it lives on the 1:1 Sessions list like
    // any other non-group package (see offeringListHref), so giving it a
    // heading here would name a place the trainer can't go. It earns a word on
    // the row instead — a six-week curriculum reads nothing like a single
    // consult, and the two would otherwise sit side by side unexplained.
    kind: p.isGroup ? runKind(p) : 'onetoone',
    name: p.name,
    // The special price is the one actually charged, so it is the one shown —
    // same rule as every other list.
    priceCents: p.specialPriceCents ?? p.priceCents,
    sub: p.isGroup
      ? null
      : [
          p.isSeries ? 'Series' : null,
          `${p.durationMins} min`,
          p.sessionCount > 1 ? `${p.sessionCount} sessions` : null,
        ].filter(Boolean).join(' · '),
    // The package EDITOR, for every kind of offering: it is the one screen that
    // holds the Tags field, so "this is in the wrong tag" and "here is where you
    // fix it" are the same tap. A group class's run screen is about a cohort,
    // not about the offering the tag is on.
    href: `/packages/${p.id}/edit`,
  }))

  const shopItems: TaggedItem[] = products.map(p => ({
    key: `product:${p.id}`,
    target: { productId: p.id },
    kind: 'product',
    name: p.name,
    priceCents: p.salePriceCents ?? p.priceCents,
    // Said plainly, because a product switched off is still in the tag and a
    // trainer looking at this list deserves to know why clients can't see it.
    sub: p.active ? null : 'Not on sale',
    href: `/products/${p.id}`,
  }))

  return (
    <>
      <PageHeader title={tag.name} back={{ href: '/offerings/tags', label: 'Tags' }} />
      <TagDetail tag={tag} items={[...offerings, ...shopItems]} />
    </>
  )
}
