import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { clientLabelFor, sanitizeNavLabels } from '@/lib/nav-labels'
import { getEnabledAddons } from '@/lib/billing'
import { listShopProducts, loadPreviewOnlyProduct } from '@/lib/shop-catalog'
import { listShopTags, resolveShopTag } from '@/lib/shop-tags'
import { mayDownloadProduct } from '@/lib/product-price'
import { ShopGrid } from './shop-grid'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Shop' }

/**
 * ?product=<id> opens that product's sheet on top of the shop.
 *
 * A query param rather than a /my-shop/[productId] route because the shop IS a
 * grid with a sheet over it — a route would have to render the grid a second
 * time to put anything behind the sheet. This way the link is shareable, Back
 * closes it, and with the param absent nothing about the page changes.
 *
 * ?tag=<id> narrows the whole shop to one of the trainer's tags. Same reason,
 * plus one more: it is a SERVER filter, so it has to reach the query, and the
 * URL is the only state a server component can read. The two params compose —
 * the tag survives opening and closing a product, and the tag-browse screen's
 * ?product= deep link still lands on an unfiltered shop with the sheet up.
 */
export default async function MyShopPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; tag?: string }>
}) {
  const active = await getActiveClient()
  if (!active) redirect('/login')
  const { product: openProductId = null, tag: tagParam = null } = await searchParams

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
  const navLabels = sanitizeNavLabels(trainer?.navLabels)
  const shopTitle = clientLabelFor('/my-shop', 'Shop', navLabels)
  // What this trainer calls the screen a tag's classes and sessions live on,
  // since the shop sends people there and has to name it the way their menu does.
  const offeringsTitle = clientLabelFor('/my-availability', 'Offerings', navLabels)

  // Clients can buy (vs request) only when the trainer has switched payments on
  // and their Connect account can actually take charges.
  const acceptPayments = profile.trainer.acceptPaymentsEnabled && profile.trainer.connectChargesEnabled

  // Read BEFORE the catalogue, because it decides what the catalogue query is.
  // A ?tag= naming something this shop doesn't offer resolves to null and the
  // client simply gets the whole shop — never an empty grid under a filter.
  const shopTags = await listShopTags(profile.trainerId)
  const activeTag = resolveShopTag(shopTags, tagParam)

  const [products, pendingRequests, hiddenPreview] = await Promise.all([
    listShopProducts(profile.trainerId, { tagId: activeTag?.id ?? null }),
    prisma.productRequest.findMany({
      where: { clientId: profile.id, status: { in: ['PENDING', 'FULFILLED'] } },
      select: { productId: true, status: true },
    }),
    // The point of previewing is usually a product that ISN'T live yet, so the
    // list above — which is exactly what a client may see — won't contain it.
    // Fetched separately and only for a trainer in preview; a real client
    // passing the same ?product= gets null and an ordinary shop.
    loadPreviewOnlyProduct({
      trainerId: profile.trainerId,
      productId: openProductId,
      isPreview: active.isPreview,
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
          openProductId={openProductId}
          tags={shopTags}
          activeTag={activeTag}
          offeringsTitle={offeringsTitle}
          products={[
            ...products.map(p => ({
              id: p.id,
              name: p.name,
              description: p.description,
              kind: p.kind as 'PHYSICAL' | 'DIGITAL',
              priceCents: p.priceCents,
              salePriceCents: p.salePriceCents,
              stockCount: p.stockCount,
              imageUrl: p.imageUrl,
              // Resolved per client, server-side. The button being hidden is
              // not a paywall: these props are serialised into the page, so a
              // URL sent "just to render with" is a URL every client has.
              downloadUrl: mayDownloadProduct(p, p.variants ?? [], purchasedIds.has(p.id))
                ? p.downloadUrl
                : null,
              category: p.category,
              featured: p.featured,
              variants: p.variants,
              requested: requestedIds.has(p.id),
              purchased: purchasedIds.has(p.id),
            })),
            // Rides along so the sheet has something to open, flagged so the
            // GRID leaves it out — the grid is meant to be exactly what the
            // client sees, and a hidden product sitting in it would be the one
            // thing a preview must never claim.
            ...(hiddenPreview
              ? [{
                  id: hiddenPreview.id,
                  name: hiddenPreview.name,
                  description: hiddenPreview.description,
                  kind: hiddenPreview.kind as 'PHYSICAL' | 'DIGITAL',
                  priceCents: hiddenPreview.priceCents,
                  salePriceCents: hiddenPreview.salePriceCents,
                  stockCount: hiddenPreview.stockCount,
                  imageUrl: hiddenPreview.imageUrl,
                  // Preview is a trainer looking at their own product, and the
                  // same rule applies — an unbought paid download stays shut.
                  downloadUrl: mayDownloadProduct(hiddenPreview, hiddenPreview.variants ?? [], false)
                    ? hiddenPreview.downloadUrl
                    : null,
                  category: hiddenPreview.category,
                  featured: hiddenPreview.featured,
                  variants: hiddenPreview.variants,
                  requested: false,
                  purchased: false,
                  hiddenFromShop: true,
                }]
              : []),
          ]}
        />
      </div>
    </div>
  )
}
