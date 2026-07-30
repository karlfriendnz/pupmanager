import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { PageHeader } from '@/components/shared/page-header'
import { ProductForm, EMPTY_PRODUCT } from '../product-form'
import type { Metadata } from 'next'
import { addonSettingsHref } from '@/lib/configurable-features'

export const metadata: Metadata = { title: 'New product' }

export default async function NewProductPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  if (!(await hasAddon(trainerId, 'shop'))) redirect(addonSettingsHref('shop'))

  const siblings = await prisma.product.findMany({
    where: { trainerId },
    select: { category: true },
  })
  const existingCategories = Array.from(
    new Set(siblings.map(s => s.category).filter(Boolean) as string[])
  ).sort()

  return (
    <>
      <PageHeader title="New product" back={{ href: '/products', label: 'Products' }} />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-8">
        <ProductForm initial={EMPTY_PRODUCT} isNew existingCategories={existingCategories} />
      </div>
    </>
  )
}
