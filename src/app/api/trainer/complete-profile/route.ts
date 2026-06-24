import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Saves the identity fields the (trainer)/layout gate requires (name +
// businessName + phone) plus the phone-visibility opt-in and an optional
// company email. Used by the /complete-profile screen that social sign-ins
// (and legacy blank accounts) are held on. Writes only to the profile the
// caller OWNS.
const schema = z.object({
  name: z.string().trim().min(2),
  businessName: z.string().trim().min(2),
  phone: z.string().trim().min(6).max(30),
  showPhoneToClients: z.boolean().optional().default(false),
  publicEmail: z.union([z.string().email(), z.literal('')]).optional(),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please fill in all fields.' }, { status: 400 })
  }
  const { name, businessName, phone, showPhoneToClients, publicEmail } = parsed.data

  // Only owners have a TrainerProfile keyed to their userId; invited staff
  // don't and shouldn't be here. Bail rather than create a stray business.
  const owned = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!owned) {
    return NextResponse.json({ error: 'No business profile to update.' }, { status: 404 })
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: session.user.id }, data: { name } }),
    prisma.trainerProfile.update({
      where: { id: owned.id },
      data: { businessName, phone, showPhoneToClients, publicEmail: publicEmail || null },
    }),
  ])

  return NextResponse.json({ ok: true })
}
