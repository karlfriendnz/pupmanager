// The tags a client can narrow the shop by.
//
// A tag is the trainer's flat, cross-type label — the same one the booking
// chooser browses by (src/lib/tags.ts, and the "Browse by tag" section on
// /my-availability). This file adds nothing to that vocabulary; it only works
// out which of those tags are worth OFFERING on the shop screen, and how many
// things each one holds there.
//
// The whole rule is: never render a filter that leads nowhere. A tag the
// trainer made and never used, or one whose only products are switched off, is
// invisible here — a client tapping a tag and landing on an empty shop would
// read it as the shop being broken.

import { prisma } from './prisma'

/** One tag, as the shop's chooser shows it. */
export interface ShopTag {
  id: string
  name: string
  /** How many on-sale products carry it. Always ≥ 1, or it isn't in the list. */
  products: number
  /**
   * Whether this tag also holds an offering — a course, a 1:1, an event.
   *
   * This is the difference between a tag and a category, and the shop says so:
   * a category is a shelf in this shop, a tag reaches out of it. When this is
   * true the shop points at the booking chooser, where the rest of the tag is.
   */
  alsoBookable: boolean
}

/** The shape read out of the database — kept separate so the counting below
 *  can be tested without one. */
export interface ShopTagRow {
  id: string
  name: string
  items: { packageId: string | null; product: { active: boolean } | null }[]
}

/**
 * Tag rows → what the shop offers, in the order they arrived.
 *
 * Ordering is the caller's (the trainer's own arrangement, lowest `order`
 * first) and is deliberately not re-sorted here: a trainer who dragged "Puppy"
 * to the top expects it at the top of every list a client meets it in.
 *
 * `product.active` rather than a plain "has a product row": a product pulled
 * from the shop still carries its tags, and counting it would put a 3 on a tag
 * with one thing under it.
 */
export function toShopTags(rows: ShopTagRow[]): ShopTag[] {
  return rows
    .map(t => ({
      id: t.id,
      name: t.name,
      products: t.items.filter(i => i.product?.active === true).length,
      alsoBookable: t.items.some(i => i.packageId != null),
    }))
    .filter(t => t.products > 0)
}

/** The trainer's tags that have something in this shop, in their own order. */
export async function listShopTags(trainerId: string): Promise<ShopTag[]> {
  const rows = await prisma.tag.findMany({
    where: { trainerId },
    // The trainer's own arrangement, same orderBy as listTags() and the
    // booking chooser — one tag list, one order, wherever it is shown.
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      items: { select: { packageId: true, product: { select: { active: true } } } },
    },
  })
  return toShopTags(rows)
}

/**
 * The ?tag= in the URL, resolved against what this shop actually offers.
 *
 * An id that is not in the list — deleted since the link was sent, emptied of
 * products, or simply another business's — comes back null and the client gets
 * the ordinary whole shop. Never an error page, and never an empty grid with a
 * filter on it that they can't explain.
 */
export function resolveShopTag(tags: ShopTag[], param: string | null | undefined): ShopTag | null {
  if (!param) return null
  return tags.find(t => t.id === param) ?? null
}
