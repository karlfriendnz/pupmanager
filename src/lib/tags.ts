import { prisma } from '@/lib/prisma'

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
