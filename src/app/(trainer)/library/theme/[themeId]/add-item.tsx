'use client'

import { useRouter } from 'next/navigation'
import { AddNameInline } from '../../library-forms'

/**
 * "New item" inside a theme. Creating one only needs a title — everything else
 * (rich-text instructions, picture, handout) is edited on the item's own page,
 * which we go straight to.
 */
export function AddItem({ themeId }: { themeId: string }) {
  const router = useRouter()
  return (
    <AddNameInline
      label="New item"
      placeholder="Item name (e.g. Loose-lead walking)"
      onAdd={async title => {
        const res = await fetch('/api/library/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ themeId, title }),
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
