import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth, unstable_update } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const schema = z.object({ companyId: z.string().min(1) })

// Switch the trainer's active business. A trainer who belongs to more than one
// organisation (e.g. owns their own AND is a team member at another) picks which
// one they're acting in. We re-point the JWT's trainerId — never trusting the
// client — so every session.user.trainerId reader follows the switch.
export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.id) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { companyId } = parsed.data

  // The user must actually hold a membership for the requested company.
  const membership = await prisma.trainerMembership.findUnique({
    where: { companyId_userId: { companyId, userId: session.user.id } },
    select: { id: true },
  })
  if (!membership) {
    return NextResponse.json({ error: "You're not a member of that organisation" }, { status: 403 })
  }

  // Triggers the jwt callback with trigger='update' and session={trainerId},
  // which validates again and re-points trainerId/membershipId/role/business.
  await unstable_update({ trainerId: companyId } as never)

  return NextResponse.json({ ok: true })
}
