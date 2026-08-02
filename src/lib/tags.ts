import { prisma } from '@/lib/prisma'
import type { TagRef } from '@/lib/offering-grouping'

/**
 * Tags — one flat list per trainer that reaches every kind of thing they sell.
 *
 * The rules that must not live in a route handler, because there are four of
 * them writing tags (the offering editor, the product editor, the tag list and
 * the reorder) and a rule enforced in three of the four is not enforced.
 */

/** How many tags one business may keep. High enough never to be met in
 *  practice, low enough that a runaway client can't fill the table. */
export const MAX_TAGS_PER_TRAINER = 200

/** How many tags one offering or product may carry. */
export const MAX_TAGS_PER_ITEM = 20

export const TAG_NAME_MAX = 40

/**
 * The name as stored → the value uniqueness is enforced on.
 *
 * Case-folded and whitespace-collapsed, because "Puppy", "puppy" and
 * "Puppy " are the same tag to everyone except a Postgres unique index. Two
 * tags saying the same word is precisely the mess this feature exists to
 * prevent, so the fold happens once, here, and both the create and the rename
 * path go through it.
 */
export function tagNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The display form: trimmed, inner runs of whitespace collapsed, case kept. */
export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/** What a target row is. Exactly one of these is ever set — see the CHECK
 *  constraint on tag_assignments. */
export type TagTarget = { packageId: string } | { productId: string }

export class TagScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TagScopeError'
  }
}

/**
 * Is this offering / product the signed-in business's own?
 *
 * Every tag read and every tag write goes through here first. An id arriving
 * from a browser is a claim, not a fact — and the damage from believing it is
 * that one trainer's label ends up on a competitor's course, visible in that
 * competitor's client app.
 */
export async function ownsTagTarget(trainerId: string, target: TagTarget): Promise<boolean> {
  const row =
    'packageId' in target
      ? await prisma.package.findFirst({ where: { id: target.packageId, trainerId }, select: { id: true } })
      : await prisma.product.findFirst({ where: { id: target.productId, trainerId }, select: { id: true } })
  return !!row
}

/**
 * Replace the tags on ONE offering or product with exactly `tagIds`.
 *
 * TENANT SCOPING IS THE WHOLE JOB HERE. Both ends are re-read against the
 * signed-in business before anything is written: a tag id from another trainer,
 * or a package id from another trainer, must not produce a row. Neither end is
 * trusted just because the other one checked out.
 *
 * Returns the tag ids actually attached, in the trainer's own tag order.
 */
export async function setTagsFor(
  trainerId: string,
  target: TagTarget,
  tagIds: string[],
): Promise<string[]> {
  const wanted = Array.from(new Set(tagIds.filter(id => typeof id === 'string' && id.length > 0)))
  if (wanted.length > MAX_TAGS_PER_ITEM) {
    throw new TagScopeError(`You can put something in up to ${MAX_TAGS_PER_ITEM} tags.`)
  }

  // 1. The thing being tagged is this business's.
  if (!(await ownsTagTarget(trainerId, target))) throw new TagScopeError('Not found')

  // 2. The tags are this business's. Anything else is dropped rather than
  //    rejected — a tag deleted in another browser tab while this form sat open
  //    should not lose the trainer the rest of their edit.
  const mine = wanted.length
    ? await prisma.tag.findMany({
        where: { id: { in: wanted }, trainerId },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
        select: { id: true },
      })
    : []
  const keep = mine.map(t => t.id)

  const where = 'packageId' in target ? { packageId: target.packageId } : { productId: target.productId }

  // Set semantics, done as one transaction: whatever the form sent IS the new
  // list. Deleting first and re-creating (rather than diffing) keeps this the
  // same three lines whichever editor calls it, and the unique index makes a
  // duplicate impossible either way.
  await prisma.$transaction([
    prisma.tagAssignment.deleteMany({ where }),
    ...(keep.length
      ? [prisma.tagAssignment.createMany({ data: keep.map(tagId => ({ tagId, ...where })) })]
      : []),
  ])

  return keep
}

/** The tag ids currently on one offering or product, in the trainer's order. */
export async function tagIdsFor(target: TagTarget): Promise<string[]> {
  const where = 'packageId' in target ? { packageId: target.packageId } : { productId: target.productId }
  const rows = await prisma.tagAssignment.findMany({
    where,
    orderBy: [{ tag: { order: 'asc' } }, { tag: { name: 'asc' } }],
    select: { tagId: true },
  })
  return rows.map(r => r.tagId)
}

export interface TagOption {
  id: string
  name: string
  order: number
}

/** The trainer's tag list, in their own arrangement. */
export async function listTags(trainerId: string): Promise<TagOption[]> {
  return prisma.tag.findMany({
    where: { trainerId },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, order: true },
  })
}

// ─── Tags for a whole offering list ──────────────────────────────────────────

/**
 * Every tag on every offering a list page is about to render, plus the order
 * the trainer arranged their tags in.
 *
 * The four offering lists (1:1, classes, casual classes, events) all want the
 * same two things, so they read them the same way: ONE query for the whole
 * page. The obvious alternative — including `tags: { include: { tag: true } }`
 * on each row's own query — is a join per list rather than a query per row, so
 * it isn't an N+1 either, but it hands back the tag NAME once per assignment
 * and gives the page no way to know the trainer's tag arrangement without a
 * second query anyway. Reading it from the tag end answers both at once.
 */
export interface OfferingTagIndex {
  /**
   * Tag ids in the trainer's own arrangement. Group headings follow it, so the
   * sections on a list sit in the same order as the tags on the tag screen.
   */
  order: string[]
  /** packageId → the tags on it, in that same arrangement. */
  byPackage: Record<string, TagRef[]>
}

/** The row shape {@link indexOfferingTags} reads — one tag and what carries it. */
export interface TagWithPackages {
  id: string
  name: string
  items: { packageId: string | null }[]
}

/**
 * Tag rows → the index a list page renders from. Pure, so the shape can be
 * tested without a database.
 *
 * Every tag lands in `order`, including ones holding nothing: the order is the
 * trainer's ARRANGEMENT, not a list of what is on this page, and a tag that is
 * empty today is the one they are about to fill. Only tags that actually reach
 * a package appear in `byPackage`, because that map is read per row.
 */
export function indexOfferingTags(tags: TagWithPackages[]): OfferingTagIndex {
  const byPackage: Record<string, TagRef[]> = {}
  for (const tag of tags) {
    for (const item of tag.items) {
      if (!item.packageId) continue
      // Arrives in the trainer's order because the caller asked for it that
      // way, and push preserves it — so a row's tags read in the same order
      // wherever they are shown.
      ;(byPackage[item.packageId] ??= []).push({ id: tag.id, name: tag.name })
    }
  }
  return { order: tags.map(t => t.id), byPackage }
}

/**
 * The trainer's tags and which of their offerings carry them. One query.
 *
 * Scoped to the signed-in business at the tag end, which is enough: a tag row
 * belongs to exactly one trainer, so an assignment reached through it can only
 * point at that trainer's own package.
 */
export async function listOfferingTags(trainerId: string): Promise<OfferingTagIndex> {
  const tags = await prisma.tag.findMany({
    where: { trainerId },
    // The same orderBy as listTags() and the booking chooser — one tag list,
    // one order, wherever it is shown.
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      // Package assignments only. A tag reaches products too, and carrying
      // those rows here would put shop items in an offering page's index.
      items: { where: { packageId: { not: null } }, select: { packageId: true } },
    },
  })
  return indexOfferingTags(tags)
}
