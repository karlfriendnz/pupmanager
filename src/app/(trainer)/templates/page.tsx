import type { Metadata } from 'next'
import { PageHeader } from '@/components/shared/page-header'
import { SectionLabel } from '@/components/shared/flat-list'
import { requireLibraryTrainer, getLibraryTree, countItems } from './library-data'
import { LibraryShell } from './library-shell'
import { LibraryTree } from './library-tree'
import { AddCategory } from './library-index-actions'

export const metadata: Metadata = { title: 'Library' }

// The Library index.
//
// On a phone the tree IS this page — one screen you can open as deep as you
// like, replacing the old types → themes → tasks drill-down. On desktop the
// same tree moves into the sticky left column (LibraryShell) and this pane
// carries the "what is this" copy plus the create action.
export default async function LibraryPage() {
  const trainerId = await requireLibraryTrainer()
  const tree = await getLibraryTree(trainerId)
  const items = countItems(tree)
  const themes = tree.reduce((n, t) => n + t.themes.length, 0)

  return (
    <>
      <PageHeader
        title="Library"
        subtitle="Reusable training items you can drop into any client's plan."
      />
      <LibraryShell tree={tree}>
        {/* Phone: the tree is the page. */}
        <div className="md:hidden">
          <LibraryTree tree={tree} />
          <AddCategory />
        </div>

        {/* Desktop: the tree lives in the rail, so this pane explains + creates. */}
        <div className="hidden md:block">
          <SectionLabel>Overview</SectionLabel>
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-6">
            <p className="text-sm font-medium text-slate-900">
              {tree.length === 0
                ? 'Your library is empty'
                : `${tree.length} categor${tree.length === 1 ? 'y' : 'ies'} · ${themes} theme${themes === 1 ? '' : 's'} · ${items} item${items === 1 ? '' : 's'}`}
            </p>
            <p className="mt-1 max-w-prose text-[13px] text-slate-500">
              {tree.length === 0
                ? 'Start with a category like “Obedience”, add themes inside it, then fill those themes with the exercises you hand out most.'
                : 'Pick anything in the tree on the left to open it. Categories and themes are renamed from inside; items open on their own page, where you can attach a picture or a handout and see who currently has it.'}
            </p>
          </div>
          <AddCategory />
        </div>
      </LibraryShell>
    </>
  )
}
