import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { requireLibraryTrainer, getLibraryTree } from '../../library-data'
import { LibraryShell } from '../../library-shell'
import { ItemEditor, ItemDangerZone } from './item-editor'
import { ItemHolders, type Holder } from './item-holders'

export const metadata: Metadata = { title: 'Library item' }

// One library item, on its own page (task 5 — it used to be an inline form in
// the task list). Everything about the item is here: what it says, what's
// attached to it, and who currently has it.
export default async function LibraryItemPage({ params }: { params: Promise<{ taskId: string }> }) {
  const trainerId = await requireLibraryTrainer()
  const { taskId } = await params

  const task = await prisma.libraryTask.findFirst({
    where: { id: taskId, theme: { type: { trainerId } } },
    include: {
      theme: { select: { id: true, name: true, type: { select: { id: true, name: true } } } },
    },
  })
  if (!task) notFound()

  // ── Who currently has this item ────────────────────────────────────────────
  // "Has" = there's a homework row (TrainingTask) on one of this trainer's
  // clients that came from this library item. Homework is a SNAPSHOT — the text
  // is copied at assign time — so the link is the new TrainingTask.libraryTaskId
  // provenance column. Rows created before that column existed (and by the
  // attach-to-session path, which still copies without a link) are matched on
  // the exact title as a best-effort fallback, which is the same comparison
  // session-library-tasks.tsx already makes.
  const assignments = await prisma.trainingTask.findMany({
    where: {
      client: { trainerId },
      OR: [
        { libraryTaskId: task.id },
        { libraryTaskId: null, title: task.title },
      ],
    },
    orderBy: { date: 'desc' },
    include: {
      client: { select: { id: true, user: { select: { name: true, email: true } } } },
      dog: { select: { name: true } },
      completion: { select: { completedAt: true } },
    },
  })

  // One row per client — the most recent assignment, plus how many they've had.
  const byClient = new Map<string, Holder>()
  for (const a of assignments) {
    const existing = byClient.get(a.client.id)
    if (existing) {
      existing.count += 1
      if (a.completion) existing.doneCount += 1
      continue
    }
    byClient.set(a.client.id, {
      clientId: a.client.id,
      name: a.client.user.name ?? a.client.user.email,
      dogName: a.dog?.name ?? null,
      latestDate: a.date.toISOString(),
      count: 1,
      doneCount: a.completion ? 1 : 0,
      linked: a.libraryTaskId === task.id,
    })
  }
  const holders = [...byClient.values()]

  const clients = await prisma.clientProfile.findMany({
    where: { trainerId, status: 'ACTIVE' },
    select: {
      id: true,
      user: { select: { name: true, email: true } },
      dog: { select: { id: true, name: true } },
      dogs: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const tree = await getLibraryTree(trainerId)

  return (
    <>
      <PageHeader
        title={task.title}
        subtitle={`${task.theme.type.name} · ${task.theme.name}`}
        back={{ href: `/templates/theme/${task.theme.id}`, label: task.theme.name }}
      />
      <LibraryShell tree={tree} activeItemId={task.id}>
        <ItemEditor
          item={{
            id: task.id,
            title: task.title,
            description: task.description,
            repetitions: task.repetitions,
            videoUrl: task.videoUrl,
            imageUrl: task.imageUrl,
            fileUrl: task.fileUrl,
            fileName: task.fileName,
          }}
        />
        <ItemHolders
          taskId={task.id}
          description={task.description}
          holders={holders}
          clients={clients.map(c => ({
            id: c.id,
            name: c.user.name ?? c.user.email,
            dogs: [...(c.dog ? [c.dog] : []), ...c.dogs],
          }))}
        />
        <ItemDangerZone
          item={{ id: task.id, title: task.title }}
          themeHref={`/templates/theme/${task.theme.id}`}
        />
      </LibraryShell>
    </>
  )
}
