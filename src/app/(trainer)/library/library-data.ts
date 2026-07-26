import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'

// Shared server helpers for the Library screens (/templates, /templates/type,
// /templates/theme, /templates/item).
//
// There is deliberately NO layout.tsx here: /templates/[templateId] and
// /templates/new belong to the separate "training template" feature and must
// not inherit the Library's tree shell. Each Library page composes the shell
// itself and pulls the tree through these helpers instead.

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

/** Total item count across the tree — used for the empty/summary states. */
export function countItems(tree: TreeType[]): number {
  return tree.reduce((n, t) => n + t.themes.reduce((m, th) => m + th.items.length, 0), 0)
}
