import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { FlatBlock, FlatRow, SectionLabel } from '@/components/shared/flat-list'
import { richTextToPlain } from '@/lib/rich-text'
import { requireLibraryTrainer, getLibraryTree } from '../../library-data'
import { LibraryShell } from '../../library-shell'
import { CategorySettings } from '../../library-forms'
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
        subtitle={`${theme.type.name} · ${theme.tasks.length} item${theme.tasks.length === 1 ? '' : 's'}`}
        back={{ href: `/templates/type/${theme.type.id}`, label: theme.type.name }}
      />
      <LibraryShell tree={tree} activeThemeId={theme.id}>
        <SectionLabel>Items</SectionLabel>
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
          <FlatBlock>
            {theme.tasks.map(task => {
              // The description is rich text; a one-line preview wants plain text.
              const preview = richTextToPlain(task.description).replace(/\s+/g, ' ').trim()
              return (
                <FlatRow
                  key={task.id}
                  label={task.title}
                  sub={preview || (task.repetitions ? `${task.repetitions} reps` : undefined)}
                  href={`/templates/item/${task.id}`}
                />
              )
            })}
          </FlatBlock>
        )}
        <AddItem themeId={theme.id} />

        <CategorySettings
          kind="theme"
          id={theme.id}
          name={theme.name}
          afterDeleteHref={`/templates/type/${theme.type.id}`}
          childCountNote={
            theme.tasks.length === 0
              ? 'This theme is empty.'
              : `Its ${theme.tasks.length} item${theme.tasks.length === 1 ? '' : 's'} go with it. Homework already handed out to clients is kept.`
          }
        />
      </LibraryShell>
    </>
  )
}
