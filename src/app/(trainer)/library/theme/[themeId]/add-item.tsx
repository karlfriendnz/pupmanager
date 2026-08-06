'use client'

import { useRouter } from 'next/navigation'
import { AddNameInline } from '../../library-forms'

/**
 * "New item" — creating one only needs a title; everything else (rich-text
 * instructions, picture, handout) is edited on the item's own page, which we go
 * straight to.
 *
 * It is used from BOTH library screens that can hold an item:
 *
 *   • a theme page passes `themeId` — the item lands in that theme;
 *   • a category page passes `typeId`  — the item lands directly in the
 *     category, with no theme at all.
 *
 * One creator rather than two, because "add an exercise" is one job however
 * deep the trainer happens to be standing. Exactly one of the two ids is given;
 * the API works out the other (a theme knows its category).
 */
export function AddItem(props: { themeId: string } | { typeId: string }) {
  const router = useRouter()
  return (
    <AddNameInline
      label="New item"
      placeholder="Item name (e.g. Loose-lead walking)"
      onAdd={async title => {
        const res = await fetch('/api/library/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...props, title }),
        })
        if (!res.ok) return 'Could not create that item.'
        const created: { id: string } = await res.json()
        router.push(`/library/item/${created.id}`)
        router.refresh()
        return null
      }}
    />
  )
}
