import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { MAX_BUFFER_MINS } from '@/lib/buffer'

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  sessionCount: z.number().int().min(0).max(52).optional(),
  weeksBetween: z.number().int().min(0).max(52).optional(),
  durationMins: z.number().int().min(15).max(480).optional(),
  // "Gap before the next session". Only ever applies to sessions booked FROM
  // NOW ON — existing sessions keep the buffer they were booked with.
  bufferMins: z.number().int().min(0).max(MAX_BUFFER_MINS).optional(),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']).optional(),
  priceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  specialPriceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  color: z.enum(['blue', 'emerald', 'amber', 'rose', 'purple', 'orange', 'teal', 'indigo', 'pink', 'cyan']).nullable().optional(),
  defaultSessionFormId: z.string().nullable().optional(),
  requireSessionNotes: z.boolean().optional(),
  isGroup: z.boolean().optional(),
  capacity: z.number().int().min(0).max(1000).nullable().optional(),
  allowDropIn: z.boolean().optional(),
  dropInPriceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  allowWaitlist: z.boolean().optional(),
  publicEnrollment: z.boolean().optional(),
  clientSelfBook: z.boolean().optional(),
  selfBookRequiresApproval: z.boolean().optional(),
  xeroAccountCode: z.string().max(50).nullable().optional(),
  // Tri-state "require payment to book": null = inherit trainer default.
  requirePayment: z.boolean().nullable().optional(),
})

async function ownPackage(packageId: string, trainerId: string) {
  return prisma.package.findFirst({ where: { id: packageId, trainerId } })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ packageId: string }> }
) {
  const guard = await guardPermission('packages.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { packageId } = await params
  if (!(await ownPackage(packageId, trainerId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Converting between 1:1 and group flips which half of the system owns this
  // package: a group package is run as ClassRuns with a shared roster, a 1:1 one
  // as per-client ClientPackage assignments. Flipping it while either exists
  // would strand them — a class run whose package is no longer a class, or
  // assignments against a package that no longer works that way — so the
  // conversion is refused while the package is in use rather than half-applied.
  let extra: Record<string, unknown> = {}
  if (parsed.data.isGroup !== undefined) {
    const current = await prisma.package.findUnique({
      where: { id: packageId },
      select: { isGroup: true },
    })
    if (current && current.isGroup !== parsed.data.isGroup) {
      if (current.isGroup) {
        const runs = await prisma.classRun.count({ where: { packageId } })
        if (runs > 0) {
          return NextResponse.json(
            { error: `This is running as ${runs} class${runs === 1 ? '' : 'es'}. Delete or finish ${runs === 1 ? 'it' : 'them'} before turning it back into a 1:1 package.` },
            { status: 409 },
          )
        }
        // Group-only settings are meaningless on a 1:1 package — clear them
        // here too, not just in the form, so any caller converts cleanly.
        extra = {
          capacity: null,
          allowDropIn: false,
          dropInPriceCents: null,
          allowWaitlist: false,
          publicEnrollment: false,
        }
      } else {
        const assigned = await prisma.clientPackage.count({ where: { packageId } })
        if (assigned > 0) {
          return NextResponse.json(
            { error: `${assigned} client${assigned === 1 ? ' is' : 's are'} assigned to this package. Convert a copy instead, or unassign first.` },
            { status: 409 },
          )
        }
      }
    }
  }

  const pkg = await prisma.package.update({
    where: { id: packageId },
    data: { ...parsed.data, ...extra },
  })
  return NextResponse.json(pkg)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ packageId: string }> }
) {
  const guard = await guardPermission('packages.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { packageId } = await params
  if (!(await ownPackage(packageId, trainerId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.package.delete({ where: { id: packageId } })
  return NextResponse.json({ ok: true })
}
