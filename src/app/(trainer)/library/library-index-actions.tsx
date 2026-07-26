'use client'

import { useRouter } from 'next/navigation'
import { AddNameInline } from './library-forms'

/** "New category" on the Library index — creates a top-level LibraryType. */
export function AddCategory() {
  const router = useRouter()
  return (
    <AddNameInline
      label="New category"
      placeholder="Category name (e.g. Obedience)"
      onAdd={async name => {
        const res = await fetch('/api/library/types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        if (!res.ok) return 'Could not create that category.'
        const created: { id: string } = await res.json()
        router.push(`/library/type/${created.id}`)
        router.refresh()
        return null
      }}
    />
  )
}
