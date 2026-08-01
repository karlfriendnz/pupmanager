import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ProductsManager } from './products-manager'
import { hasAddon } from '@/lib/billing'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'
import { addonSettingsHref } from '@/lib/configurable-features'

export const metadata: Metadata = { title: 'Products' }

export default async function ProductsPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  if (!(await hasAddon(trainerId, 'shop'))) redirect(addonSettingsHref('shop'))

  const products = await prisma.product.findMany({
    where: { trainerId },
    orderBy: [{ category: 'asc' }, { order: 'asc' }, { createdAt: 'desc' }],
  })

  return (
    <>
      <PageHeader title="Products" />
      <div className="p-4 md:p-8 w-full max-w-5xl xl:max-w-7xl mx-auto">
      <ProductsManager
        initialProducts={products.map(p => ({
          id: p.id,
          name: p.name,
          description: p.description,
          kind: p.kind as 'PHYSICAL' | 'DIGITAL',
          priceCents: p.priceCents,
          salePriceCents: p.salePriceCents,
          stockCount: p.stockCount,
          imageUrl: p.imageUrl,
          downloadUrl: p.downloadUrl,
          category: p.category,
          featured: p.featured,
          active: p.active,
          xeroAccountCode: p.xeroAccountCode,
          requirePayment: p.requirePayment,
        }))}
      />
      </div>
    </>
  )
}
