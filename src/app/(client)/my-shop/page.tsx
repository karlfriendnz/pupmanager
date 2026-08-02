import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { clientLabelFor, sanitizeNavLabels } from '@/lib/nav-labels'
import { getEnabledAddons } from '@/lib/billing'
import { ShopGrid } from './shop-grid'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Shop' }

export default async function MyShopPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: {
      id: true,
      trainerId: true,
      trainer: {
        select: {
          businessName: true,
          acceptPaymentsEnabled: true,
          connectChargesEnabled: true,
          payoutCurrency: true,
        },
      },
    },
  })
  if (!profile) redirect('/login')

  // The shop is a trainer add-on — bounce direct visits when it's off, matching
  // the hidden nav item + home shortcut.
  if (!(await getEnabledAddons(profile.trainerId)).has('shop')) redirect('/home')

  // The trainer's word for their products, so the client's shop is called what the
  // trainer calls it. Read server-side here since this heading is rendered on the
  // server, not inside the shell's context.
  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: profile.trainerId }, select: { navLabels: true },
  })
  const shopTitle = clientLabelFor('/my-shop', 'Shop', sanitizeNavLabels(trainer?.navLabels))

  // Clients can buy (vs request) only when the trainer has switched payments on
  // and their Connect account can actually take charges.
  const acceptPayments = profile.trainer.acceptPaymentsEnabled && profile.trainer.connectChargesEnabled

  const [products, pendingRequests] = await Promise.all([
    prisma.product.findMany({
      where: { trainerId: profile.trainerId, active: true },
      orderBy: [{ featured: 'desc' }, { category: 'asc' }, { order: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        description: true,
        kind: true,
        priceCents: true,
        salePriceCents: true,
        stockCount: true,
        imageUrl: true,
        downloadUrl: true,
        category: true,
        featured: true,
        // The sizes/colours a client picks between. Only the ACTIVE ones — a
        // hidden variant is off the shop, exactly as a hidden product is.
        variants: {
          where: { active: true },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true, name: true, priceCents: true, salePriceCents: true, stockCount: true,
            // The photo and the words for THIS one. Null on either = the
            // product's, which is what nearly every variant carries.
            imageUrl: true, description: true,
          },
        },
      },
    }),
    prisma.productRequest.findMany({
      where: { clientId: profile.id, status: { in: ['PENDING', 'FULFILLED'] } },
      select: { productId: true, status: true },
    }),
  ])

  const requestedIds = new Set(pendingRequests.filter(r => r.status === 'PENDING').map(r => r.productId))
  // A digital product the client has actually paid for unlocks its download.
  const purchasedIds = new Set(pendingRequests.filter(r => r.status === 'FULFILLED').map(r => r.productId))

  return (
    <div className="px-5 lg:px-8 pt-6 max-w-3xl mx-auto w-full">
      <h1 className="text-2xl font-bold text-slate-900">{shopTitle}</h1>
      <p className="text-sm text-slate-500 mt-1">
        From <span className="font-medium text-slate-700">{profile.trainer.businessName}</span>
      </p>

      <div className="mt-6">
        <ShopGrid
          acceptPayments={acceptPayments}
          currency={profile.trainer.payoutCurrency}
          products={products.map(p => ({
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
            variants: p.variants,
            requested: requestedIds.has(p.id),
            purchased: purchasedIds.has(p.id),
          }))}
        />
      </div>
    </div>
  )
}
