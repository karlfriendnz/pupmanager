import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { effectivePriceCents } from '@/lib/product-price'
import { PageHeader } from '@/components/shared/page-header'
import { ProductDetail } from './product-detail'
import type { Purchase } from './product-purchases'
import type { Metadata } from 'next'
import { addonSettingsHref } from '@/lib/configurable-features'

export const metadata: Metadata = { title: 'Product' }

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  if (!(await hasAddon(trainerId, 'shop'))) redirect(addonSettingsHref('shop'))

  const { productId } = await params

  // Scoped by trainerId, not just id — another tenant's product is a 404 here,
  // exactly as it is on the API route.
  const product = await prisma.product.findFirst({
    where: { id: productId, trainerId },
  })
  if (!product) notFound()

  const [requests, paidItems] = await Promise.all([
    // Pay-later orders and standing requests.
    prisma.productRequest.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        client: {
          select: { id: true, user: { select: { name: true } }, dog: { select: { name: true } } },
        },
      },
    }),
    // Actual money: a payment line pointing at this product, on a paid payment.
    prisma.paymentItem.findMany({
      where: { productId: product.id, payment: { status: 'PAID', trainerId } },
      orderBy: { payment: { createdAt: 'desc' } },
      select: {
        id: true,
        unitAmount: true,
        quantity: true,
        payment: {
          select: {
            createdAt: true,
            client: {
              select: { id: true, user: { select: { name: true } }, dog: { select: { name: true } } },
            },
          },
        },
      },
    }),
  ])

  const paid: Purchase[] = paidItems.map(item => ({
    id: `pay_${item.id}`,
    clientId: item.payment.client?.id ?? null,
    clientName: item.payment.client?.user?.name ?? 'A client',
    dogName: item.payment.client?.dog?.name ?? null,
    state: 'PAID',
    amountCents: item.unitAmount * item.quantity,
    at: item.payment.createdAt.toISOString(),
  }))

  // A FULFILLED request raised by a card checkout is already counted above, so
  // only the ones with no matching paid line are listed — otherwise a single
  // purchase would appear twice with two different states.
  const paidClientIds = new Set(paid.map(p => p.clientId).filter(Boolean))
  const fromRequests: Purchase[] = requests
    .filter(r => r.status !== 'CANCELLED' && !paidClientIds.has(r.client.id))
    .map(r => ({
      id: `req_${r.id}`,
      clientId: r.client.id,
      clientName: r.client.user?.name ?? 'A client',
      dogName: r.client.dog?.name ?? null,
      state: r.status === 'FULFILLED' ? 'OWING' : 'REQUESTED',
      // What they'll be billed — the sale price when there is one, same as the
      // invoice raised for them.
      amountCents: r.status === 'FULFILLED' ? effectivePriceCents(product) : null,
      at: r.createdAt.toISOString(),
    }))

  const purchases = [...paid, ...fromRequests].sort((a, b) => b.at.localeCompare(a.at))

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
      <PageHeader title={product.name} back={{ href: '/products', label: 'Products' }} />
      {/* Full width. Capped at 48rem the form was a narrow ribbon down the
          middle of a desktop screen, which is what made the page background
          the loudest thing on it — the fields now use the room instead. */}
      <div className="w-full min-w-0 p-4 md:p-8">
        <ProductDetail
          product={{
            id: product.id,
            name: product.name,
            description: product.description,
            kind: product.kind as 'PHYSICAL' | 'DIGITAL',
            priceCents: product.priceCents,
            salePriceCents: product.salePriceCents,
            stockCount: product.stockCount,
            imageUrl: product.imageUrl,
            downloadUrl: product.downloadUrl,
            category: product.category,
            categoryId: product.categoryId,
            featured: product.featured,
            active: product.active,
            xeroAccountCode: product.xeroAccountCode,
            requirePayment: product.requirePayment,
          }}
          existingCategories={existingCategories}
          purchases={purchases}
        />
      </div>
    </>
  )
}
