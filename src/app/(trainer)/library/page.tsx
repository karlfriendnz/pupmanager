import type { Metadata } from 'next'
import { PageHeader } from '@/components/shared/page-header'
import { FlatBlock, SectionHeader } from '@/components/shared/flat-list'
import { requireLibraryTrainer, getLibraryTree } from './library-data'
import { countItems } from './library-shape'
import { LibraryShell } from './library-shell'
import { LibraryCategories } from './library-categories'
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
      />
      <LibraryShell tree={tree}>
        {tree.length === 0 ? (
          <>
            <SectionHeader action={<AddCategory />}>Categories</SectionHeader>
            <FlatBlock><LibraryEmpty /></FlatBlock>
          </>
        ) : (
          <LibraryCategories
            categories={tree.map(type => ({
              id: type.id,
              name: type.name,
              themes: type.themes.length,
              // Themed AND loose — an item added straight into the category
              // still counts as one thing in here.
              items: countItems(type),
            }))}
          />
        )}
      </LibraryShell>
    </>
  )
}
