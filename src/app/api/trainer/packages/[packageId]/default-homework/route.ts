import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

// The default homework configured on an offering — list + create. Scoped to the
// trainer's own package and gated by packages.manage, exactly like the
// comms-flow routes that hang off the same offering.

async function ownedPackage(trainerId: string, id: string) {
  return prisma.package.findFirst({ where: { id, trainerId }, select: { id: true, sessionCount: true } })
}

export async function GET(_req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { packageId } = await params
  if (!(await ownedPackage(ctx.companyId, packageId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await prisma.packageDefaultTask.findMany({
    where: { packageId },
    orderBy: [{ sessionIndex: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    include: {
      libraryTask: {
        select: {
          id: true,
          title: true,
          description: true,
          repetitions: true,
          videoUrl: true,
          theme: { select: { name: true, type: { select: { name: true } } } },
        },
      },
    },
  })

  return NextResponse.json(
    rows.map(r => ({
      id: r.id,
      sessionIndex: r.sessionIndex,
      order: r.order,
      libraryTaskId: r.libraryTaskId,
      title: r.libraryTask?.title ?? r.title ?? '',
      description: r.libraryTask?.description ?? r.description,
      repetitions: r.libraryTask?.repetitions ?? r.repetitions,
      videoUrl: r.libraryTask?.videoUrl ?? r.videoUrl,
      // Where the item lives, so the editor can show "Foundations · Loose lead".
      libraryPath: r.libraryTask ? `${r.libraryTask.theme.type.name} · ${r.libraryTask.theme.name}` : null,
    })),
  )
}

const createSchema = z
  .object({
    // null / omitted = suggest after every session.
    sessionIndex: z.number().int().positive().nullable().optional(),
    libraryTaskId: z.string().nullable().optional(),
    title: z.string().min(2).nullable().optional(),
    description: z.string().nullable().optional(),
    repetitions: z.number().int().positive().nullable().optional(),
    videoUrl: z.string().url().nullable().optional(),
  })
  // A default is either a library item or an inline task — one or the other has
  // to give it a name, or there is nothing to suggest.
  .refine(d => !!d.libraryTaskId || !!d.title, { message: 'Pick a library item or give the task a title.' })

export async function POST(req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { packageId } = await params
  if (!(await ownedPackage(ctx.companyId, packageId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // A library item must belong to this trainer. Unlike /api/tasks — where an
  // unresolvable id is dropped because the task still stands on its own — here
  // the id IS the task, so a bad one is refused.
  if (parsed.data.libraryTaskId) {
    const owned = await prisma.libraryTask.findFirst({
      where: { id: parsed.data.libraryTaskId, theme: { type: { trainerId: ctx.companyId } } },
      select: { id: true },
    })
    if (!owned) return NextResponse.json({ error: 'Library item not found' }, { status: 404 })
  }

  const sessionIndex = parsed.data.sessionIndex ?? null
  const last = await prisma.packageDefaultTask.findFirst({
    where: { packageId, sessionIndex },
    orderBy: { order: 'desc' },
    select: { order: true },
  })

  const row = await prisma.packageDefaultTask.create({
    data: {
      packageId,
      sessionIndex,
      order: (last?.order ?? -1) + 1,
      libraryTaskId: parsed.data.libraryTaskId ?? null,
      // Inline fields are only meaningful without a library item behind them.
      title: parsed.data.libraryTaskId ? null : (parsed.data.title ?? null),
      description: parsed.data.libraryTaskId ? null : (parsed.data.description ?? null),
      repetitions: parsed.data.libraryTaskId ? null : (parsed.data.repetitions ?? null),
      videoUrl: parsed.data.libraryTaskId ? null : (parsed.data.videoUrl ?? null),
    },
  })

  return NextResponse.json(row, { status: 201 })
}
