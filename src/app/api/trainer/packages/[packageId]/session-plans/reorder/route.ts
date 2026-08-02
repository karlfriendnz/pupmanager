import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'

// Rearranging a series curriculum — "teach loose-lead in week 1 this time".
//
// A step and its homework are joined ONLY by the number they share
// (PackageSessionPlan.sessionIndex and PackageDefaultTask.sessionIndex — see the
// schema comment above PackageSessionPlan). There is no foreign key between
// them, so moving a step without moving its homework in the same breath leaves
// session 1 teaching recall with session 3's loose-lead homework attached, and
// nothing in the data would say anything was wrong. That is why this is ONE
// endpoint over both tables in ONE transaction, rather than the offering editor
// firing a plans reorder and a homework reorder and hoping both land.

export const runtime = 'nodejs'

const schema = z.object({
  /**
   * The session numbers currently on screen, in the order the trainer dragged
   * them into. The FIRST entry is the number whose plan + homework should end up
   * in the first of those slots.
   *
   * Deliberately the numbers rather than plan row ids: a slot with nothing
   * written in it yet has no PackageSessionPlan row at all (the editor only
   * creates one when a title is typed), but it can still be dragged, and
   * whatever homework hangs off it has to travel with it.
   */
  order: z.array(z.number().int().positive()).min(2).max(200),
})

export async function POST(req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const { packageId } = await params

  // Count-owned-before-writing, the same shape as /api/library/types/reorder:
  // one lookup scoped to the caller's own company, and a package that isn't
  // theirs writes nothing at all rather than half a reorder.
  const owned = await prisma.package.findFirst({
    where: { id: packageId, trainerId: ctx.companyId },
    select: { id: true },
  })
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })
  const { order } = parsed.data

  if (new Set(order).size !== order.length) {
    return NextResponse.json({ error: 'Duplicate sessions' }, { status: 400 })
  }

  // The SET of occupied numbers never changes — only which content sits on
  // each. Targets are the same numbers sorted ascending, so a curriculum with a
  // gap in it (a step written past a shortened offering's end, kept visible on
  // purpose) comes out with the same gap rather than being silently squashed
  // into 1..N. It also means nothing outside `order` can ever be collided with:
  // no number is freed and no new number is claimed.
  const targets = [...order].sort((a, b) => a - b)
  const moves = order
    .map((from, i) => ({ from, to: targets[i] }))
    .filter(m => m.from !== m.to)

  if (moves.length === 0) return NextResponse.json({ ok: true, moved: 0 })

  // Plans are addressed by ROW ID, not by their current number: the second
  // pass below has already changed the numbers, so a where-clause on
  // sessionIndex would match the wrong row (or nothing).
  const plans = await prisma.packageSessionPlan.findMany({
    where: { packageId, sessionIndex: { in: moves.map(m => m.from) } },
    select: { id: true, sessionIndex: true },
  })
  const planIdByIndex = new Map(plans.map(p => [p.sessionIndex, p.id]))

  await prisma.$transaction(async tx => {
    // TWO PASSES, and the reason is `@@unique([packageId, sessionIndex])` on
    // PackageSessionPlan. Swapping 1 and 2 by writing the final numbers
    // straight in means the first UPDATE tries to put a second row on
    // (packageId, 2) while the row already there is still sitting on it — a
    // unique violation mid-flight, on a rearrangement that is perfectly valid
    // once finished. So every moving row is first parked on the NEGATIVE of
    // its destination, which no real row can hold (sessionIndex is validated
    // positive everywhere it is written), and only then written to its real
    // number. Negatives are unique because destinations are.
    //
    // UPDATE rather than delete-and-recreate, deliberately:
    // TrainingSession.sessionPlanId pins a booked session to the exact plan row
    // that covered it (see lib/series.ts), with onDelete: SetNull. Recreating
    // the rows would mint new ids and quietly blank every one of those pins —
    // the diary would forget what each past session actually taught.
    for (const m of moves) {
      const id = planIdByIndex.get(m.from)
      if (id) await tx.packageSessionPlan.update({ where: { id }, data: { sessionIndex: -m.to } })
    }
    for (const m of moves) {
      const id = planIdByIndex.get(m.from)
      // `order` is kept in step with the number, exactly as the upsert one route
      // up does — the number IS the order for a curriculum.
      if (id) await tx.packageSessionPlan.update({ where: { id }, data: { sessionIndex: m.to, order: m.to } })
    }

    // Homework moves with its session, in the same transaction, because that is
    // the whole point of this route. There is no unique index on
    // PackageDefaultTask, but the same two passes are still required: written
    // in one go, homework moved from 3 to 1 would be picked up again by the
    // later "everything on 1 goes to 2" and end up dragged twice.
    //
    // Matching on `sessionIndex: <number>` never touches the null bucket —
    // "after EVERY session" homework belongs to no session, so there is nothing
    // for a reorder to move it to. It stays where it is by construction.
    for (const m of moves) {
      await tx.packageDefaultTask.updateMany({
        where: { packageId, sessionIndex: m.from },
        data: { sessionIndex: -m.to },
      })
    }
    for (const m of moves) {
      await tx.packageDefaultTask.updateMany({
        where: { packageId, sessionIndex: -m.to },
        data: { sessionIndex: m.to },
      })
    }
  })

  // NOTHING here touches TrainingSession. On a class run the sessions are real
  // diary entries a cohort turns up to, so reordering the curriculum changes
  // what is TAUGHT in week 1 — which is the point — while the dates, times and
  // venues stay exactly where they were. A trainer swapping two steps must not
  // move anybody's Tuesday.
  return NextResponse.json({ ok: true, moved: moves.length })
}
