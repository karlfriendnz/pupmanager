import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { FlatBlock, SectionHeader } from '@/components/shared/flat-list'
import { richTextToPlain } from '@/lib/rich-text'
import { requireLibraryTrainer, getLibraryTree } from '../../library-data'
import { LibraryShell } from '../../library-shell'
import { LibraryRowList } from '../../library-row-list'
import { CategorySettingsButton } from '../../library-forms'
import { AddItem } from './add-item'

export const metadata: Metadata = { title: 'Library theme' }

// One theme (LibraryTheme) — the items inside it, plus its own rename/delete.
// Same rule as the category above it: you open it to change it.
export default async function LibraryThemePage({ params }: { params: Promise<{ themeId: string }> }) {
  const trainerId = await requireLibraryTrainer()
  const { themeId } = await params

  const theme = await prisma.libraryTheme.findFirst({
    where: { id: themeId, type: { trainerId } },
    include: {
      type: { select: { id: true, name: true } },
      tasks: { orderBy: { order: 'asc' } },
    },
  })
  if (!theme) notFound()

  const tree = await getLibraryTree(trainerId)

  return (
    <>
      <PageHeader
        title={theme.name}
        back={{ href: `/library/type/${theme.type.id}`, label: theme.type.name }}
      />
      <LibraryShell tree={tree}>
        <SectionHeader
          action={
            <span className="flex items-center gap-1.5">
              <AddItem themeId={theme.id} />
              {/* Same shape as the category above it — the theme's own settings
                  beside the only other action, not in a block below its items. */}
              <CategorySettingsButton
                kind="theme"
                id={theme.id}
                name={theme.name}
                afterDeleteHref={`/library/type/${theme.type.id}`}
                // Deleting a theme no longer deletes what is inside it. The
                // items keep their category and reappear on it under "In this
                // category" — say so, because the old wording promised the
                // opposite and a trainer who believed it would never tidy.
                childCountNote={
                  theme.tasks.length === 0
                    ? 'This theme is empty.'
                    : `Its ${theme.tasks.length} item${theme.tasks.length === 1 ? '' : 's'} ${theme.tasks.length === 1 ? 'is' : 'are'} kept — ${theme.tasks.length === 1 ? 'it moves' : 'they move'} into ${theme.type.name}. Only the grouping goes.`
                }
              />
            </span>
          }
        >
          Items
        </SectionHeader>
        {theme.tasks.length === 0 ? (
          <FlatBlock>
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-900">No items yet</p>
              <p className="mt-1 text-[13px] text-slate-500">
                An item is one exercise you hand out — its instructions, a picture, a handout.
              </p>
            </div>
          </FlatBlock>
        ) : (
          <LibraryRowList
            endpoint="/api/library/tasks/reorder"
            noun="item"
            rows={theme.tasks.map(task => {
              // The description is rich text; a one-line preview wants plain text.
              const preview = richTextToPlain(task.description).replace(/\s+/g, ' ').trim()
              return {
                id: task.id,
                label: task.title,
                sub: preview || (task.repetitions ? `${task.repetitions} reps` : undefined),
                href: `/library/item/${task.id}`,
              }
            })}
          />
        )}

      </LibraryShell>
    </>
  )
}
