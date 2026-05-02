import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const patchSchema = z.object({
  businessName: z.string().min(2).optional(),
  phone: z.string().optional(),
  logoUrl: z.string().url().optional().or(z.literal('')),
  dashboardBgUrl: z.string().url().optional().or(z.literal('')),
  inviteTemplate: z.string().optional(),
  // Schedule view prefs. Hours 0–23, days 1=Mon..7=Sun, end > start.
  scheduleStartHour: z.number().int().min(0).max(23).optional(),
  scheduleEndHour: z.number().int().min(1).max(24).optional(),
  scheduleDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  scheduleExtraFields: z.array(z.enum(['location', 'description', 'sessionType', 'duration', 'title'])).max(2).optional(),
  // Built-in column ids OR "custom:<cuid>" for trainer-defined custom fields.
  clientListColumns: z.array(z.string().regex(/^(email|dog|extraDogs|nextSession|compliance|shared|custom:[a-z0-9]+)$/)).optional(),
})

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const profile = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
  })

  return NextResponse.json(profile)
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const profile = await prisma.trainerProfile.update({
    where: { userId: session.user.id },
    data: parsed.data,
  })

  return NextResponse.json(profile)
}
