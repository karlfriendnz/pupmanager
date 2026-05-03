import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { evaluateAchievementForAllClients } from '@/lib/achievements'
import { z } from 'zod'

const TRIGGER_TYPES = [
  'MANUAL',
  'FIRST_SESSION',
  'SESSIONS_COMPLETED',
  'IN_PERSON_SESSIONS',
  'VIRTUAL_SESSIONS',
  'CONSECUTIVE_SESSIONS_ATTENDED',
  'FIRST_PACKAGE_ASSIGNED',
  'PACKAGES_COMPLETED',
  'FIRST_HOMEWORK_DONE',
  'HOMEWORK_TASKS_DONE',
  'HOMEWORK_STREAK_DAYS',
  'PERFECT_WEEK',
  'CLIENT_ANNIVERSARY_DAYS',
  'MESSAGES_SENT',
  'PRODUCTS_PURCHASED',
  'PROFILE_COMPLETED',
] as const

// Triggers that need a numeric threshold. Anything not in this list is a binary
// "first / done" trigger and triggerValue is forced to null.
const TRIGGERS_NEEDING_VALUE = new Set([
  'SESSIONS_COMPLETED',
  'IN_PERSON_SESSIONS',
  'VIRTUAL_SESSIONS',
  'CONSECUTIVE_SESSIONS_ATTENDED',
  'PACKAGES_COMPLETED',
  'HOMEWORK_TASKS_DONE',
  'HOMEWORK_STREAK_DAYS',
  'PERFECT_WEEK',
  'CLIENT_ANNIVERSARY_DAYS',
  'MESSAGES_SENT',
  'PRODUCTS_PURCHASED',
])

const schema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional().nullable(),
  icon: z.string().max(8).optional().nullable(),
  color: z.string().max(20).optional().nullable(),
  triggerType: z.enum(TRIGGER_TYPES).default('MANUAL'),
  triggerValue: z.number().int().positive().nullable().optional(),
})

async function getTrainerId(userId: string) {
  const p = await prisma.trainerProfile.findUnique({ where: { userId }, select: { id: true } })
  return p?.id ?? null
}

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = await getTrainerId(session.user.id)
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const achievements = await prisma.achievement.findMany({
    where: { trainerId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json(achievements)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = await getTrainerId(session.user.id)
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Force triggerValue to null on binary triggers, require it on numeric ones.
  const needsValue = TRIGGERS_NEEDING_VALUE.has(parsed.data.triggerType)
  const triggerValue = needsValue ? (parsed.data.triggerValue ?? null) : null
  if (needsValue && triggerValue == null) {
    return NextResponse.json({ error: 'Trigger value is required for this trigger' }, { status: 400 })
  }

  const count = await prisma.achievement.count({ where: { trainerId } })
  const achievement = await prisma.achievement.create({
    data: {
      trainerId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      icon: parsed.data.icon ?? null,
      color: parsed.data.color ?? null,
      order: count,
      triggerType: parsed.data.triggerType,
      triggerValue,
    },
  })

  // Retroactive backfill for any client that already qualifies. Fire-and-forget
  // so the create response isn't gated on it.
  if (achievement.triggerType !== 'MANUAL') {
    evaluateAchievementForAllClients(achievement).catch(() => {})
  }

  return NextResponse.json(achievement, { status: 201 })
}
