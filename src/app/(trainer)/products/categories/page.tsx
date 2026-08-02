import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { addonSettingsHref } from '@/lib/configurable-features'
import { PageHeader } from '@/components/shared/page-header'
import { CategoriesView } from './categories-view'

export const metadata: Metadata = { title: 'Categories' }

export default async function ProductCategoriesPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  if (!(await hasAddon(trainerId, 'shop'))) redirect(addonSettingsHref('shop'))

  const [categories, total, uncategorised] = await Promise.all([
    prisma.productCategory.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, _count: { select: { products: true } } },
    }),
    prisma.product.count({ where: { trainerId } }),
    prisma.product.count({ where: { trainerId, categoryId: null } }),
  ])

  return (
    <>
      <PageHeader title="Categories" back={{ href: '/products', label: 'Products' }} />
      <CategoriesView
        categories={categories.map(c => ({ id: c.id, name: c.name, products: c._count.products }))}
        total={total}
        uncategorised={uncategorised}
      />
    </>
  )
}
