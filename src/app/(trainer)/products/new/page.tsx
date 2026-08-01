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

  // The shelves themselves, in the order they appear on /products — not the
  // distinct words off the products, which is what this used to be and which
  // could offer a category that has no shelf to sit on.
  const existingCategories = await prisma.productCategory.findMany({
    where: { trainerId },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true },
  })

  return (
    <>
      <PageHeader title="New product" back={{ href: '/products', label: 'Products' }} />
      <div className="mx-auto w-full max-w-3xl p-4 md:p-8">
        <ProductForm initial={EMPTY_PRODUCT} isNew existingCategories={existingCategories} />
      </div>
    </>
  )
}
