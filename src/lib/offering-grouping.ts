/**
 * Grouping an offering list by tag.
 *
 * A tag is a LABEL, not a folder — an offering can carry several, and "Puppy
 * Foundations" genuinely is both a puppy class and a recall class. So a row
 * with two tags appears under BOTH headings rather than being filed under
 * whichever happened to be first. Filing it once would quietly hide it from a
 * trainer who went looking under the other word, which is the one thing a
 * grouping control must never do.
 *
 * The duplication is deliberate and legible: the heading above the card says
 * why it is there. What would NOT be legible is a card missing from a section
 * whose name is written on it.
 */

export interface TagRef {
  id: string
  name: string
}

export interface OfferingGroup<T> {
  /** Tag id, or UNTAGGED_KEY for the run of things carrying no tag at all. */
  key: string
  label: string
  items: T[]
}

export const UNTAGGED_KEY = '__untagged__'

/** What the heading says for offerings with no tag. Last, and named plainly. */
export const UNTAGGED_LABEL = 'No tag'

/**
 * @param rows      the list already filtered to the visible tab, in the
 *                  trainer's own arranged order — which is preserved WITHIN
 *                  each group, because that order is what clients see.
 * @param tagsOf    how to read a row's tags.
 * @param tagOrder  tag ids in the trainer's arrangement, from their tag screen.
 *                  Groups follow it, so the headings on this page sit in the
 *                  same order as the tags themselves. Anything not in the list
 *                  (a tag added in another tab, say) sorts after, by name.
 */
export function groupOfferingsByTag<T>(
  rows: readonly T[],
  tagsOf: (row: T) => readonly TagRef[] | undefined,
  tagOrder: readonly string[] = [],
): OfferingGroup<T>[] {
  const byTag = new Map<string, OfferingGroup<T>>()
  const untagged: T[] = []

  for (const row of rows) {
    const tags = tagsOf(row) ?? []
    if (tags.length === 0) {
      untagged.push(row)
      continue
    }
    for (const tag of tags) {
      const existing = byTag.get(tag.id)
      if (existing) existing.items.push(row)
      else byTag.set(tag.id, { key: tag.id, label: tag.name, items: [row] })
    }
  }

  const rank = new Map(tagOrder.map((id, i) => [id, i]))
  const groups = [...byTag.values()].sort((a, b) => {
    const ra = rank.get(a.key)
    const rb = rank.get(b.key)
    // Ranked tags first, in the trainer's order; unranked after, alphabetically.
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return a.label.localeCompare(b.label)
  })

  // Untagged goes last: it is the remainder, not a category. Omitted entirely
  // when everything carries a tag, so a tidy list has no "No tag" heading
  // hanging off the bottom of it.
  if (untagged.length > 0) {
    groups.push({ key: UNTAGGED_KEY, label: UNTAGGED_LABEL, items: untagged })
  }

  return groups
}

/**
 * Whether grouping is worth offering at all on this list.
 *
 * With no tags anywhere, the control can only ever produce one section called
 * "No tag" — a switch whose only outcome is a heading. Hide it instead: a
 * trainer who has never made a tag should not have to learn what this does.
 */
export function canGroupByTag<T>(rows: readonly T[], tagsOf: (row: T) => readonly TagRef[] | undefined): boolean {
  return rows.some(row => (tagsOf(row) ?? []).length > 0)
}
