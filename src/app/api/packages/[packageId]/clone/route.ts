import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

/**
 * Duplicate a package. Most programs a trainer runs are a variation on one they
 * already have — same structure, different length or price — so copying beats
 * re-entering a dozen fields.
 *
 * Copies the template only. Deliberately NOT copied:
 *  - assignments (a copy nobody is on)
 *  - the Xero account code (income mapping is per-product and should be a
 *    conscious choice, not inherited silently)
 *  - class runs off a group package (the copy is a fresh template)
 */
export async function POST(_req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const guard = await guardPermission('packages.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { packageId } = await params
  // Scoped to the caller's own business — never trust the id alone.
  const src = await prisma.package.findFirst({ where: { id: packageId, trainerId } })
  if (!src) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // "Puppy Foundations" → "Puppy Foundations (copy)" → "(copy 2)" …
  const base = `${src.name} (copy`
  const existing = await prisma.package.count({
    where: { trainerId, name: { startsWith: base } },
  })
  const name = existing === 0 ? `${src.name} (copy)` : `${src.name} (copy ${existing + 1})`

  // Land it directly above the original so the copy is where they're looking.
  const created = await prisma.package.create({
    data: {
      trainerId,
      name,
      description: src.description,
      sessionCount: src.sessionCount,
      weeksBetween: src.weeksBetween,
      durationMins: src.durationMins,
      bufferMins: src.bufferMins,
      sessionType: src.sessionType,
      priceCents: src.priceCents,
      specialPriceCents: src.specialPriceCents,
      color: src.color,
      defaultSessionFormId: src.defaultSessionFormId,
      requireSessionNotes: src.requireSessionNotes,
      isGroup: src.isGroup,
      capacity: src.capacity,
      allowDropIn: src.allowDropIn,
      dropInPriceCents: src.dropInPriceCents,
      allowWaitlist: src.allowWaitlist,
      publicEnrollment: src.publicEnrollment,
      clientSelfBook: src.clientSelfBook,
      selfBookRequiresApproval: src.selfBookRequiresApproval,
      requirePayment: src.requirePayment,
      order: src.order,
    },
    select: { id: true, name: true },
  })

  return NextResponse.json(created, { status: 201 })
}
