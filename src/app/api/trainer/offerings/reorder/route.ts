import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

// One reorder endpoint for every offering list a trainer can drag: 1:1
// packages, group classes, casual classes, events and memberships. The order it
// writes is the order CLIENTS see in the booking flow, so it's the trainer
// arranging their shopfront rather than a per-admin view preference.
//
// Classes / casual classes / events are all ClassRuns; packages and memberships
// are their own tables. Each id is checked against the trainer's own rows before
// anything is written, so a foreign id can't be dragged into their list.

const schema = z.object({
  kind: z.enum(['package', 'classRun', 'membership']),
  // Ordered ids — index in the array becomes the new `order`.
  ids: z.array(z.string().min(1)).min(1).max(500),
})

export async function POST(req: Request) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { kind, ids } = parsed.data

  // Duplicate ids would write two positions for one row — reject rather than
  // silently letting the last one win.
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: 'Duplicate ids' }, { status: 400 })
  }

  const where = { id: { in: ids }, trainerId: ctx.companyId }
  const owned =
    kind === 'package' ? await prisma.package.findMany({ where, select: { id: true } })
    : kind === 'classRun' ? await prisma.classRun.findMany({ where, select: { id: true } })
    : await prisma.membership.findMany({ where, select: { id: true } })

  if (owned.length !== ids.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.$transaction(
    ids.map((id, order) =>
      kind === 'package' ? prisma.package.update({ where: { id }, data: { order } })
      : kind === 'classRun' ? prisma.classRun.update({ where: { id }, data: { order } })
      : prisma.membership.update({ where: { id }, data: { order } }),
    ),
  )

  return NextResponse.json({ ok: true, count: ids.length })
}
