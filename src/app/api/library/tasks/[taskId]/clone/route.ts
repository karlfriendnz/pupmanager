import { NextResponse } from 'next/server'

import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { mediaColumns, readMedia } from '@/lib/library-media'

// Copy a library item. Everything about it comes across — the instructions, the
// reps, and every attachment in its order — because the reason to duplicate
// one is that the copy is nearly the same: "Sit" and "Sit at distance" differ
// by a sentence.
//
// The copy lands DIRECTLY BELOW the original rather than at the end of the
// theme. A trainer duplicating the fourth of nine items is building a variant
// of that item, and hunting for it at the bottom of the list is the whole cost
// of getting this wrong.
//
// What does NOT come across: who has it. Homework already handed out belongs to
// the original — a copy nobody has been given yet is the point.
export const runtime = 'nodejs'

export async function POST(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard

  const { taskId } = await params

  // Ownership is the item's own category — item → type → trainer. Read off the
  // item, not through its theme, because a theme is optional and a loose item
  // has none.
  const original = await prisma.libraryTask.findFirst({
    where: { id: taskId, type: { trainerId: guard.companyId } },
  })
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const copy = await prisma.$transaction(async tx => {
    // Make room at original.order + 1 so the copy can sit there. Scoped to the
    // list the original is actually IN — its theme, or the loose items of its
    // category when it has no theme. `{ themeId: null }` on its own would
    // renumber every trainer's loose items.
    await tx.libraryTask.updateMany({
      where: original.themeId
        ? { themeId: original.themeId, order: { gt: original.order } }
        : { typeId: original.typeId, themeId: null, order: { gt: original.order } },
      data: { order: { increment: 1 } },
    })
    return tx.libraryTask.create({
      data: {
        // The copy lands beside the original — same category, same theme (or
        // the same absence of one).
        typeId: original.typeId,
        themeId: original.themeId,
        title: `${original.title} (copy)`,
        description: original.description,
        repetitions: original.repetitions,
        wantsLog: original.wantsLog,
        // Everything attached, in order — the copy is meant to be the same
        // lesson. readMedia so an item that predates the list copies its
        // picture and handout too, rather than arriving empty.
        ...mediaColumns(readMedia(original)),
        order: original.order + 1,
      },
    })
  })

  return NextResponse.json({ id: copy.id, title: copy.title }, { status: 201 })
}
