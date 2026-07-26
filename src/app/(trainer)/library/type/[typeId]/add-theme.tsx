'use client'

import { useRouter } from 'next/navigation'
import { AddNameInline } from '../../library-forms'

/** "New theme" inside a category — creates a LibraryTheme and opens it. */
export function AddTheme({ typeId }: { typeId: string }) {
  const router = useRouter()
  return (
    <AddNameInline
      label="New theme"
      placeholder="Theme name (e.g. Basic commands)"
      onAdd={async name => {
        const res = await fetch('/api/library/themes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, typeId }),
        })
        if (!res.ok) return 'Could not create that theme.'
        const created: { id: string } = await res.json()
        router.push(`/library/theme/${created.id}`)
        router.refresh()
        return null
      }}
    />
  )
}
