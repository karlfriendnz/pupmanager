import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { mergeClientDogs } from '@/lib/dogs'
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
  // is copied at assign time — so the link is the TrainingTask.libraryTaskId
  // provenance column. BOTH paths that hand an item to a client now stamp it
  // (assign-to-client and attach-to-session), so a rename no longer loses
  // anyone. Rows created before the column existed have no id and are matched
  // on the exact title as a best-effort fallback — that fallback is only ever
  // wrong in the direction of showing a same-titled task that wasn't ours, and
  // `linked` below tells the two apart on screen.
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
    // By NAME — this list is scanned for a person, and newest-first put them in
    // an order nobody can predict. Nulls last so an unnamed contact doesn't
    // squat the top of the picker.
    orderBy: { user: { name: { sort: 'asc', nulls: 'last' } } },
  })

  const tree = await getLibraryTree(trainerId)

  return (
    <>
      <PageHeader
        title={task.title}
        subtitle={`${task.theme.type.name} · ${task.theme.name}`}
        back={{ href: `/library/theme/${task.theme.id}`, label: task.theme.name }}
      />
      <LibraryShell tree={tree}>
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
            dogs: mergeClientDogs(c.dog, c.dogs),
          }))}
        />
        <ItemDangerZone
          item={{ id: task.id, title: task.title }}
          themeHref={`/library/theme/${task.theme.id}`}
        />
      </LibraryShell>
    </>
  )
}
