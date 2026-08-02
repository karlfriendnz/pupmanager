import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { TagsView } from './tags-view'

export const metadata: Metadata = { title: 'Tags' }

/**
 * Tags live UNDER /offerings rather than in the left nav.
 *
 * A tag is not a place a trainer works — it is a property of the things they
 * sell — and /offerings is already "one hub for everything a trainer sells".
 * A nav entry would also need a NAV_LABEL_CATALOG row so trainers could rename
 * it, for a screen most of them will open twice a year.
 *
 * No add-on gate: a tag reaches offerings as well as products, so a trainer
 * with the shop switched off still has plenty to label.
 */
export default async function TagsPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const tags = await prisma.tag.findMany({
    where: { trainerId },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, _count: { select: { items: true } } },
  })

  return (
    <>
      <PageHeader title="Tags" back={{ href: '/offerings', label: 'Offerings' }} />
      <TagsView tags={tags.map(t => ({ id: t.id, name: t.name, items: t._count.items }))} />
    </>
  )
}
