// The client shop's product query, in one place.
//
// There are now two callers with opposite rules: the shop itself, which shows
// what a client may see, and a trainer previewing ONE product from
// /products/[productId] before it goes live — which is, by definition, a
// product no client may see yet.
//
// They live together deliberately. `active: true` on the list is the whole of
// what hides an unfinished product from every real client, and the preview
// lookup below is the only way past it — gated on `isPreview`, which
// getActiveClient sets ONLY for a trainer holding a preview cookie for one of
// their own clients. Split across two files these two facts drift apart.

import { prisma } from './prisma'

/**
 * One query shape, two callers.
 *
 * The preview lookup goes through findMany for a single row on purpose: the
 * select is written once, so a field added for the shop can never be missing
 * from the preview and leave the trainer looking at a product that renders
 * differently from the real thing.
 */
function findShopProducts(where: {
  trainerId: string
  active: boolean
  id?: string
  tags?: { some: { tagId: string } }
}) {
  return prisma.product.findMany({
    where,
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
      // hidden variant is off the shop, exactly as a hidden product is. That
      // holds in preview too: a variant the trainer has switched off would
      // still be switched off the day the product goes live, so showing it
      // would be a preview of something that never happens.
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
  })
}

export type ShopProduct = Awaited<ReturnType<typeof findShopProducts>>[number]

/**
 * Everything this trainer sells that a client is allowed to see.
 *
 * `tagId` narrows it to one of the trainer's tags. It is a WHERE, not a filter
 * applied afterwards: the shop is a catalogue, and shipping all of it so the
 * browser can hide most of it costs the client the whole download for a
 * quarter of the page. The caller validates the id against the trainer's own
 * tags first, so a tag from another business narrows to nothing rather than
 * reaching across the tenant boundary — but `trainerId` here makes that safe
 * either way.
 */
export function listShopProducts(trainerId: string, opts?: { tagId?: string | null }) {
  const tagId = opts?.tagId ?? null
  return findShopProducts({
    trainerId,
    active: true,
    ...(tagId ? { tags: { some: { tagId } } } : {}),
  })
}

/**
 * The one hidden product a trainer asked to preview, or null.
 *
 * Three gates, all of which have to pass:
 *  - `isPreview` — a real client never gets here, whatever they put in the
 *    query string, because getActiveClient only reports a preview for a
 *    TRAINER whose preview cookie names one of their OWN clients.
 *  - `trainerId` — another business's draft is not "forbidden", it is simply
 *    not found, same as everywhere else in this app.
 *  - `active: false` — a live product is already in listShopProducts above,
 *    and matching it here would show it to the trainer twice.
 *
 * Note what this does NOT do: it never flips `active`. The product stays
 * hidden; the trainer is just allowed to read it while wearing the client's
 * view. The buy and request routes both 404 on an inactive product, so nothing
 * can be ordered off this screen either.
 */
export async function loadPreviewOnlyProduct({
  trainerId,
  productId,
  isPreview,
}: {
  trainerId: string
  productId: string | null | undefined
  isPreview: boolean
}): Promise<ShopProduct | null> {
  if (!isPreview || !productId) return null
  const [product] = await findShopProducts({ trainerId, id: productId, active: false })
  return product ?? null
}
