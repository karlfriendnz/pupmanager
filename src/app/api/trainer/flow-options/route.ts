import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'

// Everything a flow step can POINT AT, for this trainer, in one call.
//
// A FORM step names one of their forms, a TASK step one of their library items,
// a CHOOSE_OFFERING step some of their offerings. Three pickers, three lists —
// and three separate fetches from a phone opening one sheet is three chances to
// be staring at a spinner. They are small, they are all read-only, and the
// builder needs them together, so they come together.
//
// Names ONLY. Nothing here is a URL, a price or a body of text: the builder
// renders labels, and a list endpoint that hands back more than the labels is
// how a paid download's URL ended up in page source (AGENTS.md bug #5).

// READ-ONLY, so any member of the team may ask — the same posture as
// `GET /api/forms`. The flow editor is mounted on four different screens, each
// behind a different permission (classes.manage, packages.manage,
// settings.edit); gating the label lookup on any one of them would leave a
// trainer with the other permission looking at rows that say "not chosen yet"
// about a form that is chosen. Nothing here is worth more than the names.
export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId

  const [forms, tasks, offerings] = await Promise.all([
    prisma.form.findMany({
      where: { trainerId },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, isActive: true, usableAsIntake: true, usableAsEnquiry: true },
    }),
    prisma.libraryTask.findMany({
      // The library is a type → theme → task tree, and only the type carries the
      // tenant. Filtering on the task alone would return every trainer's
      // homework.
      where: { theme: { type: { trainerId } } },
      orderBy: [{ title: 'asc' }],
      select: { id: true, title: true, theme: { select: { name: true } } },
      take: 500,
    }),
    prisma.package.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, isGroup: true, isEvent: true },
      take: 300,
    }),
  ])

  return NextResponse.json({
    forms: forms.map(f => ({ id: f.id, name: f.name, isActive: f.isActive, intake: f.usableAsIntake, enquiry: f.usableAsEnquiry })),
    tasks: tasks.map(t => ({ id: t.id, title: t.title, group: t.theme?.name ?? null })),
    offerings: offerings.map(p => ({ id: p.id, name: p.name })),
  })
}
