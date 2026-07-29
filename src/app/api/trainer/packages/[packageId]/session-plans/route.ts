import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

// The curriculum of a SERIES — the steps a trainer defines up front ("session 2
// is loose-lead walking"). Scoped to the trainer's own package and gated by
// packages.manage, exactly like the default-homework routes that hang off the
// same offering and are edited beside these.
//
// Serves a group class and a 1:1 session identically: the curriculum belongs to
// the Package, which is the template behind both, so there is one editor and
// one route rather than a pair that have to be kept in step.

async function ownedPackage(trainerId: string, id: string) {
  return prisma.package.findFirst({ where: { id, trainerId }, select: { id: true, sessionCount: true } })
}

/**
 * Keep `packages.isSeries` true exactly while a curriculum exists.
 *
 * The flag is DERIVED, never picked. A series is a curriculum on an ordinary
 * offering — not a kind of offering — so there is no "make this a series"
 * switch to find and no kind card to choose: writing the first step is what
 * makes it one, and clearing the last is what stops it being one. Nothing else
 * writes this column, which is why it went unset (and every branch that reads
 * it went dead) for as long as it had no owner.
 */
async function syncSeriesFlag(packageId: string) {
  const steps = await prisma.packageSessionPlan.count({ where: { packageId } })
  await prisma.package.updateMany({
    where: { id: packageId, isSeries: steps > 0 ? false : true },
    data: { isSeries: steps > 0 },
  })
}

export async function GET(_req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { packageId } = await params
  if (!(await ownedPackage(ctx.companyId, packageId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // `privateNote` is returned HERE and only here — this route is gated by
  // packages.manage, so nothing without trainer rights can reach it. Any
  // client-facing query must select title/description by name instead.
  const rows = await prisma.packageSessionPlan.findMany({
    where: { packageId },
    orderBy: [{ sessionIndex: 'asc' }],
    select: { id: true, sessionIndex: true, title: true, description: true, privateNote: true, order: true },
  })
  return NextResponse.json(rows)
}

const upsertSchema = z.object({
  sessionIndex: z.number().int().positive(),
  title: z.string().trim().min(1).max(120),
  /** PUBLIC — the client reads this. Rich text. */
  description: z.string().max(4000).nullable().optional(),
  /** PRIVATE — trainer only. Never returned to a client-facing caller. */
  privateNote: z.string().max(4000).nullable().optional(),
})

/**
 * Define (or redefine) one step.
 *
 * An upsert rather than a create, because the editor works step by step down a
 * numbered list — there is exactly one "session 2", and typing into it a second
 * time is editing it, not adding another. The unique index on
 * (packageId, sessionIndex) says the same thing at the database.
 *
 * A step with no title is deleted rather than stored blank: clearing the box is
 * how a trainer says "nothing planned for this one", and an empty step would
 * otherwise render as a titleless row nobody can get rid of.
 */
export async function POST(req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { packageId } = await params
  const pkg = await ownedPackage(ctx.companyId, packageId)
  if (!pkg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const blank = typeof body?.title === 'string' && body.title.trim() === ''
  if (blank) {
    const idx = z.number().int().positive().safeParse(body?.sessionIndex)
    if (!idx.success) return NextResponse.json({ error: 'sessionIndex required' }, { status: 400 })
    await prisma.packageSessionPlan.deleteMany({ where: { packageId, sessionIndex: idx.data } })
    // Clearing the LAST step stops this being a series — see syncSeriesFlag.
    await syncSeriesFlag(packageId)
    return NextResponse.json({ deleted: true })
  }

  const parsed = upsertSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const row = await prisma.packageSessionPlan.upsert({
    where: { packageId_sessionIndex: { packageId, sessionIndex: parsed.data.sessionIndex } },
    create: {
      packageId,
      sessionIndex: parsed.data.sessionIndex,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      privateNote: parsed.data.privateNote ?? null,
      // The number IS the order. `order` is kept only so the column matches its
      // siblings and a future drag-to-reorder has somewhere to land.
      order: parsed.data.sessionIndex,
    },
    update: {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      // Absent means "leave it alone", not "clear it" — unlike the two fields
      // above, which the editor always sends. A caller that patches a title
      // must not be able to silently delete a note it never mentioned.
      ...(parsed.data.privateNote !== undefined && { privateNote: parsed.data.privateNote }),
    },
    select: { id: true, sessionIndex: true, title: true, description: true, privateNote: true, order: true },
  })

  // Writing the FIRST step is what makes this offering a series.
  await syncSeriesFlag(packageId)

  return NextResponse.json(row, { status: 201 })
}
