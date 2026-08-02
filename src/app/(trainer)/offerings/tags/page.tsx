import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { TagsView } from './tags-view'

export const metadata: Metadata = { title: 'Tags' }

/**
 * Tags live under /offerings, and are reached BOTH from the hub and from the
 * left menu — but the menu row only appears once a tag exists.
 *
 * The route stayed put when the menu entry arrived (Karl, 2026-08-02) because
 * the two ways in answer different questions. The hub row is where a trainer
 * MEETS the idea, so it shows at zero and reads "No tags yet — tap to create
 * one"; the menu row is for the trainer who already thinks in tags and wants
 * them one tap away. A menu row at zero would be neither: a permanent line of
 * chrome naming a concept its owner has never used. See hiddenNavHrefs in
 * (trainer)/layout.tsx for how the count reaches the shell.
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
