'use client'

import { Layers } from 'lucide-react'
import { FlatTile, FlatTileGrid } from '@/components/shared/flat-list'

// The landing screen's grid of top-level categories.
//
// This is a client component purely so the icon can be imported HERE. FlatTile
// takes a LucideIcon, and a lucide component can't be handed across the
// server/client boundary — a Server Component passing `icon={Layers}` throws
// "Only plain objects can be passed to Client Components". Same trap the
// offerings hub hit. So the page passes plain data and the icon stays local.
//
// One grid, one layout, at every width (AGENTS.md "One layout per component") —
// FlatTileGrid is the phone home's two-up block, and the container is what
// changes on desktop, not this.

export interface CategoryTile {
  id: string
  name: string
  themes: number
  items: number
}

export function LibraryCategoryGrid({ categories }: { categories: CategoryTile[] }) {
  return (
    <FlatTileGrid count={categories.length}>
      {categories.map(c => (
        <FlatTile
          key={c.id}
          icon={Layers}
          label={c.name}
          sub={`${c.themes} theme${c.themes === 1 ? '' : 's'} · ${c.items} item${c.items === 1 ? '' : 's'}`}
          href={`/library/type/${c.id}`}
        />
      ))}
    </FlatTileGrid>
  )
}
