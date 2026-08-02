import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ProductsBrowser } from './products-browser'
import { hasAddon } from '@/lib/billing'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'
import { addonSettingsHref } from '@/lib/configurable-features'

export const metadata: Metadata = { title: 'Products' }

export default async function ProductsPage({
  searchParams,
}: {
  // Set by the phone's Categories page when you pick a shelf there.
  searchParams: Promise<{ category?: string }>
}) {
  const { category } = await searchParams
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  if (!(await hasAddon(trainerId, 'shop'))) redirect(addonSettingsHref('shop'))

  // Ordered the way the browser shows them: shelves in their own order, and
  // the things on a shelf in theirs.
  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true, name: true, kind: true, priceCents: true, salePriceCents: true,
        imageUrl: true, stockCount: true, categoryId: true, featured: true, active: true,
      },
    }),
    prisma.productCategory.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, _count: { select: { products: true } } },
    }),
  ])

  return (
    <>
      <PageHeader title="Products" />
      <ProductsBrowser
        initialSelected={category ?? null}
        categories={categories.map(c => ({ id: c.id, name: c.name, products: c._count.products }))}
        products={products.map(p => ({
          id: p.id,
          name: p.name,
          kind: p.kind,
          priceCents: p.priceCents,
          salePriceCents: p.salePriceCents,
          imageUrl: p.imageUrl,
          stockCount: p.stockCount,
          categoryId: p.categoryId,
          featured: p.featured,
          active: p.active,
        }))}
      />
    </>
  )
}
