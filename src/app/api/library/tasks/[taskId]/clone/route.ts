import { NextResponse } from 'next/server'

import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

// Copy a library item. Everything about it comes across — the instructions, the
// reps, the video, the picture, the handout — because the reason to duplicate
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

  // Ownership is two levels up — item → theme → type → trainer.
  const original = await prisma.libraryTask.findFirst({
    where: { id: taskId, theme: { type: { trainerId: guard.companyId } } },
  })
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const copy = await prisma.$transaction(async tx => {
    // Make room at original.order + 1 so the copy can sit there.
    await tx.libraryTask.updateMany({
      where: { themeId: original.themeId, order: { gt: original.order } },
      data: { order: { increment: 1 } },
    })
    return tx.libraryTask.create({
      data: {
        themeId: original.themeId,
        title: `${original.title} (copy)`,
        description: original.description,
        repetitions: original.repetitions,
        wantsLog: original.wantsLog,
        videoUrl: original.videoUrl,
        imageUrl: original.imageUrl,
        fileUrl: original.fileUrl,
        fileName: original.fileName,
        order: original.order + 1,
      },
    })
  })

  return NextResponse.json({ id: copy.id, title: copy.title }, { status: 201 })
}
