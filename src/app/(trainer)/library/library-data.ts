import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'

// Shared server helpers for the Library screens (/library, /library/type,
// /library/theme, /library/item).
//
// The Library used to live at /templates, sharing that segment with the
// unrelated "training template" feature (/templates/[templateId], /templates/new)
// — which is why its sub-paths had to be literal segments that out-rank a
// dynamic sibling. It owns /library outright now, so that constraint is gone.
//
// Still no layout.tsx, for a plainer reason: PageHeader has to render as a
// SIBLING of the page's content wrapper (see its layout contract), and a layout
// can only wrap `children` as one blob. Putting the shell in a layout would push
// each page's header inside the tree's grid column. So every page composes
// LibraryShell itself and pulls the tree through these helpers.

export interface TreeItem {
  id: string
  title: string
}

export interface TreeTheme {
  id: string
  name: string
  items: TreeItem[]
}

export interface TreeType {
  id: string
  name: string
  themes: TreeTheme[]
}

/**
 * Auth + add-on gate every Library page runs. Returns the trainer id.
 *
 * Mirrors what the old single-page Library did inline; the Training library
 * add-on is free and default-on, so this only bites trainers who turned it off.
 */
export async function requireLibraryTrainer(): Promise<string> {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  if (!(await hasAddon(trainerId, 'library'))) redirect('/settings?tab=addons')
  return trainerId
}

/** The whole library, ordered, shaped for the navigation tree. */
export async function getLibraryTree(trainerId: string): Promise<TreeType[]> {
  const types = await prisma.libraryType.findMany({
    where: { trainerId },
    orderBy: { order: 'asc' },
    include: {
      themes: {
        orderBy: { order: 'asc' },
        include: { tasks: { orderBy: { order: 'asc' }, select: { id: true, title: true } } },
      },
    },
  })
  return types.map(t => ({
    id: t.id,
    name: t.name,
    themes: t.themes.map(th => ({
      id: th.id,
      name: th.name,
      items: th.tasks.map(tk => ({ id: tk.id, title: tk.title })),
    })),
  }))
}
