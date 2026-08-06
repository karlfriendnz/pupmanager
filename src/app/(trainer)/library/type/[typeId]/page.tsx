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
import { AddTheme } from './add-theme'
import { AddItem } from '../../theme/[themeId]/add-item'

export const metadata: Metadata = { title: 'Library category' }

// One category (LibraryType). Its themes are listed here, and — task 1 — its
// own name is edited from INSIDE it rather than from a pencil on the index row.
//
// It also carries "New item". A theme is optional grouping, not a required
// step, so adding one exercise no longer means inventing a theme to put it in:
// the item is created straight into this category and listed below the themes
// under "In this category". Same creator as the theme screen uses — one way to
// make a library item, not two.
export default async function LibraryTypePage({ params }: { params: Promise<{ typeId: string }> }) {
  const trainerId = await requireLibraryTrainer()
  const { typeId } = await params

  const type = await prisma.libraryType.findFirst({
    where: { id: typeId, trainerId },
    include: {
      themes: {
        orderBy: { order: 'asc' },
        include: { _count: { select: { tasks: true } } },
      },
      // The loose items — the ones with no theme. `themeId: null` IS the
      // definition; without this filter every themed item would be listed twice.
      tasks: { where: { themeId: null }, orderBy: { order: 'asc' } },
    },
  })
  if (!type) notFound()

  const tree = await getLibraryTree(trainerId)
  const looseItems = type.tasks
  const itemTotal = type.themes.reduce((n, th) => n + th._count.tasks, 0) + looseItems.length

  return (
    <>
      <PageHeader
        title={type.name}
        // No counts line under the title: the themes are listed directly below
        // with their own item counts, so it only said the same thing twice.
        back={{ href: '/library', label: 'Library' }}
      />
      <LibraryShell tree={tree}>
        <SectionHeader
          action={
            <span className="flex items-center gap-1.5">
              <AddTheme typeId={type.id} />
              <AddItem typeId={type.id} />
              {/* The category's own settings, beside the only other actions on
                  the screen — not in a block below everything inside it. */}
              <CategorySettingsButton
                kind="type"
                id={type.id}
                name={type.name}
                afterDeleteHref="/library"
                childCountNote={
                  type.themes.length === 0 && looseItems.length === 0
                    ? 'This category is empty.'
                    : `Its ${type.themes.length} theme${type.themes.length === 1 ? '' : 's'} and ${itemTotal} item${itemTotal === 1 ? '' : 's'} go with it. Homework already handed out to clients is kept.`
                }
              />
            </span>
          }
        >
          Themes
        </SectionHeader>
        {type.themes.length === 0 ? (
          // Only when the category is genuinely empty. A category holding loose
          // items is being used exactly as intended, and telling it off for
          // having no themes is the nag AGENTS.md says not to write.
          looseItems.length === 0 ? (
            <FlatBlock>
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-medium text-slate-900">Nothing in here yet</p>
                <p className="mt-1 text-[13px] text-slate-500">
                  Add an item straight into this category, or group several under a theme like &ldquo;Basic commands&rdquo;.
                </p>
              </div>
            </FlatBlock>
          ) : null
        ) : (
          <LibraryRowList
            endpoint="/api/library/themes/reorder"
            noun="theme"
            rows={type.themes.map(theme => ({
              id: theme.id,
              label: theme.name,
              sub: `${theme._count.tasks} item${theme._count.tasks === 1 ? '' : 's'}`,
              href: `/library/theme/${theme.id}`,
            }))}
          />
        )}

        {/* The items sitting directly in the category. Absent entirely when
            there are none — an added item that shows up nowhere is worse than
            no section, and an empty one is just noise. */}
        {looseItems.length > 0 && (
          <div className="mt-6">
            <SectionHeader>In this category</SectionHeader>
            <LibraryRowList
              endpoint="/api/library/tasks/reorder"
              noun="item"
              rows={looseItems.map(task => {
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
          </div>
        )}
      </LibraryShell>
    </>
  )
}
