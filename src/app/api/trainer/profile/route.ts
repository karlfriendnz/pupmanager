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
  // 3- or 6-digit hex (with leading #), or empty string to clear.
  emailAccentColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional().or(z.literal('')),
  // Schedule view prefs. Hours 0–23, days 1=Mon..7=Sun, end > start.
  scheduleStartHour: z.number().int().min(0).max(23).optional(),
  scheduleEndHour: z.number().int().min(1).max(24).optional(),
  scheduleDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  // Built-in session/client field ids OR "custom:<cuid>". Mirrors the
  // /clients column selector so trainers can pick the same fields here.
  scheduleExtraFields: z.array(z.string().regex(/^(location|description|sessionType|duration|title|email|extraDogs|compliance|custom:[a-z0-9]+)$/)).max(2).optional(),
  // Built-in column ids OR "custom:<cuid>" for trainer-defined custom fields.
  clientListColumns: z.array(z.string().regex(/^(email|dog|breed|extraDogs|nextSession|compliance|shared|custom:[a-z0-9]+)$/)).optional(),
  // null = flat list. "nextDay" = group by day of next booking.
  // "custom:<cuid>" = group by custom-field value.
  clientListGroupBy: z.string().regex(/^(nextDay|custom:[a-z0-9]+)$/).nullable().optional(),
  // Ordered list of intake-form sections. Each entry has a required name and
  // an optional description (shown to the client at the top of the section).
  intakeSectionOrder: z.array(z.object({
    name: z.string().min(1).max(60),
    description: z.string().max(500).nullable().optional(),
  })).max(50).optional(),
  // Master publish flag for the intake form. False = draft, hidden from clients.
  intakeFormPublished: z.boolean().optional(),
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

  const data = { ...parsed.data }
  // Empty string from the colour input means "clear this" — store as null
  // so the email template falls back to the default.
  if (data.emailAccentColor === '') data.emailAccentColor = null as unknown as string

  const profile = await prisma.trainerProfile.update({
    where: { userId: session.user.id },
    data,
  })

  return NextResponse.json(profile)
}
