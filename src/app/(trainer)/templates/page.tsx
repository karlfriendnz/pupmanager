import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { LibraryBrowser } from './library-browser'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Library' }

export default async function LibraryPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const types = await prisma.libraryType.findMany({
    where: { trainerId },
    orderBy: { order: 'asc' },
    include: {
      themes: {
        orderBy: { order: 'asc' },
        include: { tasks: { orderBy: { order: 'asc' } } },
      },
    },
  })

  const clients = await prisma.clientProfile.findMany({
    where: { trainerId, status: 'ACTIVE' },
    include: {
      user: { select: { name: true, email: true } },
      dog: { select: { id: true, name: true } },
      dogs: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <LibraryBrowser
      initialTypes={types.map(t => ({
        id: t.id,
        name: t.name,
        themes: t.themes.map(th => ({
          id: th.id,
          name: th.name,
          typeId: th.typeId,
          tasks: th.tasks.map(tk => ({
            id: tk.id,
            title: tk.title,
            description: tk.description,
            repetitions: tk.repetitions,
            videoUrl: tk.videoUrl,
            themeId: tk.themeId,
          })),
        })),
      }))}
      clients={clients.map(c => ({
        id: c.id,
        name: c.user.name ?? c.user.email,
        dogs: [
          ...(c.dog ? [c.dog] : []),
          ...c.dogs,
        ],
      }))}
    />
  )
}
