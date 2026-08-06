// The SHAPE of the Library's navigation tree, and the pure helpers over it.
//
// Deliberately its own module with NO imports at all. `library-data.ts` next
// door reaches `@/lib/auth` and `@/lib/prisma`, and `library-tree.tsx` is a
// `'use client'` component — a single VALUE import of a helper from there
// dragged the whole server chain (auth → … → invoicing → `after` from
// `next/server`) into the browser bundle and broke the dev build. `import type`
// is erased and would have been fine; `countItems` is not.
//
// So anything both sides need lives here. Server helpers stay in library-data.

export interface TreeItem {
  id: string
  title: string
}

export interface TreeTheme {
  id: string
  name: string
  items: TreeItem[]
}

export interface TreeType {
  id: string
  name: string
  themes: TreeTheme[]
  /**
   * Items sitting DIRECTLY in the category, with no theme.
   *
   * A theme is optional grouping (LibraryTask.themeId is nullable), so a
   * category's contents are its themes AND these. Anything counting "how many
   * items are in here" has to add both, or a trainer adds an item and watches
   * the count stay at zero.
   */
  items: TreeItem[]
}

/** Every item in a category, themed or loose — the number its tile shows. */
export function countItems(type: TreeType): number {
  return type.themes.reduce((n, th) => n + th.items.length, 0) + type.items.length
}
