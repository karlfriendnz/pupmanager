import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { FlatBlock, FlatRow, SectionLabel } from '@/components/shared/flat-list'
import { requireLibraryTrainer, getLibraryTree } from '../../library-data'
import { LibraryShell } from '../../library-shell'
import { CategorySettings } from '../../library-forms'
import { AddTheme } from './add-theme'

export const metadata: Metadata = { title: 'Library category' }

// One category (LibraryType). Its themes are listed here, and — task 1 — its
// own name is edited from INSIDE it rather than from a pencil on the index row.
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
    },
  })
  if (!type) notFound()

  const tree = await getLibraryTree(trainerId)
  const itemTotal = type.themes.reduce((n, th) => n + th._count.tasks, 0)

  return (
    <>
      <PageHeader
        title={type.name}
        // No counts line under the title: the themes are listed directly below
        // with their own item counts, so it only said the same thing twice.
        back={{ href: '/library', label: 'Library' }}
      />
      <LibraryShell tree={tree}>
        <AddTheme typeId={type.id} />
        <SectionLabel>Themes</SectionLabel>
        {type.themes.length === 0 ? (
          <FlatBlock>
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-900">No themes yet</p>
              <p className="mt-1 text-[13px] text-slate-500">
                Themes group the items inside this category — &ldquo;Basic commands&rdquo;, &ldquo;Leash manners&rdquo;.
              </p>
            </div>
          </FlatBlock>
        ) : (
          <FlatBlock>
            {type.themes.map(theme => (
              <FlatRow
                key={theme.id}
                label={theme.name}
                sub={`${theme._count.tasks} item${theme._count.tasks === 1 ? '' : 's'}`}
                href={`/library/theme/${theme.id}`}
              />
            ))}
          </FlatBlock>
        )}

        <CategorySettings
          kind="type"
          id={type.id}
          name={type.name}
          afterDeleteHref="/library"
          childCountNote={
            type.themes.length === 0
              ? 'This category is empty.'
              : `Its ${type.themes.length} theme${type.themes.length === 1 ? '' : 's'} and ${itemTotal} item${itemTotal === 1 ? '' : 's'} go with it. Homework already handed out to clients is kept.`
          }
        />
      </LibraryShell>
    </>
  )
}
