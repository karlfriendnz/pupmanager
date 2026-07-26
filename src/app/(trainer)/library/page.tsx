import type { Metadata } from 'next'
import { PageHeader } from '@/components/shared/page-header'
import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'
import { requireLibraryTrainer, getLibraryTree } from './library-data'
import { LibraryShell } from './library-shell'
import { LibraryCategoryGrid } from './library-category-grid'
import { LibraryEmpty } from './library-empty'
import { AddCategory } from './library-index-actions'

export const metadata: Metadata = { title: 'Library' }

// The Library's landing screen: the top-level categories, as a grid.
//
// ONE grid, the same shape at 390px and 1440px — FlatTileGrid is the phone
// home's two-up block, so the two screens read as the same app. It gets no
// variant that reflows it; the CONTAINER simply grows on desktop, where the
// grid sits beside the tree rail (AGENTS.md "One layout per component").
//
// Each tile carries a name AND what's inside it — a grid of bare labels would
// be worse than the list it replaced. Tapping one drills in: category → theme
// → item, which is also how a phone gets around, since the tree is desktop-only.
export default async function LibraryPage() {
  const trainerId = await requireLibraryTrainer()
  const tree = await getLibraryTree(trainerId)

  return (
    <>
      <PageHeader
        title="Library"
        subtitle="Reusable training items you can drop into any client's plan."
      />
      <LibraryShell tree={tree}>
        <SectionLabel>Categories</SectionLabel>
        {tree.length === 0 ? (
          <FlatBlock><LibraryEmpty /></FlatBlock>
        ) : (
          <LibraryCategoryGrid
            categories={tree.map(type => ({
              id: type.id,
              name: type.name,
              themes: type.themes.length,
              items: type.themes.reduce((n, th) => n + th.items.length, 0),
            }))}
          />
        )}
        <AddCategory />
      </LibraryShell>
    </>
  )
}
