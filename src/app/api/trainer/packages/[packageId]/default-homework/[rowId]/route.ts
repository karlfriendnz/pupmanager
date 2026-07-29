import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

// Edit / remove one default-homework row on an offering. The row id is checked
// through its package's trainerId, so one trainer can never reach another's.

async function ownedRow(trainerId: string, packageId: string, rowId: string) {
  return prisma.packageDefaultTask.findFirst({
    where: { id: rowId, packageId, package: { trainerId } },
    select: { id: true, libraryTaskId: true },
  })
}

const patchSchema = z.object({
  sessionIndex: z.number().int().positive().nullable().optional(),
  order: z.number().int().min(0).optional(),
  title: z.string().min(2).nullable().optional(),
  description: z.string().nullable().optional(),
  repetitions: z.number().int().positive().nullable().optional(),
  videoUrl: z.string().url().nullable().optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ packageId: string; rowId: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { packageId, rowId } = await params
  const row = await ownedRow(ctx.companyId, packageId, rowId)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const d = parsed.data
  const data: Record<string, unknown> = {}
  if ('sessionIndex' in d) data.sessionIndex = d.sessionIndex ?? null
  if (d.order !== undefined) data.order = d.order
  // The text of a library-backed default lives in the library; editing it here
  // would silently fork the two. Those fields are ignored for such rows.
  if (!row.libraryTaskId) {
    if (d.title !== undefined) data.title = d.title
    if (d.description !== undefined) data.description = d.description
    if (d.repetitions !== undefined) data.repetitions = d.repetitions
    if (d.videoUrl !== undefined) data.videoUrl = d.videoUrl
  }

  const updated = await prisma.packageDefaultTask.update({ where: { id: rowId }, data })
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ packageId: string; rowId: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { packageId, rowId } = await params
  if (!(await ownedRow(ctx.companyId, packageId, rowId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.packageDefaultTask.delete({ where: { id: rowId } })
  return NextResponse.json({ ok: true })
}
