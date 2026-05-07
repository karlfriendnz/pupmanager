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

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional().nullable(),
  icon: z.string().max(8).optional().nullable(),
  color: z.string().max(20).optional().nullable(),
  order: z.number().int().optional(),
  published: z.boolean().optional(),
  triggerType: z.enum(TRIGGER_TYPES).optional(),
  triggerValue: z.number().int().positive().nullable().optional(),
})

async function ensureOwner(userId: string, achievementId: string) {
  const profile = await prisma.trainerProfile.findUnique({ where: { userId }, select: { id: true } })
  if (!profile) return null
  const achievement = await prisma.achievement.findUnique({ where: { id: achievementId } })
  if (!achievement || achievement.trainerId !== profile.id) return null
  return { trainerId: profile.id, achievement }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ achievementId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { achievementId } = await ctx.params
  const owner = await ensureOwner(session.user.id, achievementId)
  if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Resolve next trigger config so we can normalise triggerValue per type.
  const nextType = parsed.data.triggerType ?? owner.achievement.triggerType
  const needsValue = TRIGGERS_NEEDING_VALUE.has(nextType)
  let nextValue: number | null | undefined = undefined
  if ('triggerValue' in parsed.data || parsed.data.triggerType !== undefined) {
    nextValue = needsValue
      ? (parsed.data.triggerValue ?? owner.achievement.triggerValue ?? null)
      : null
    if (needsValue && nextValue == null) {
      return NextResponse.json({ error: 'Trigger value is required for this trigger' }, { status: 400 })
    }
  }

  const updated = await prisma.achievement.update({
    where: { id: achievementId },
    data: {
      ...parsed.data,
      ...(nextValue !== undefined && { triggerValue: nextValue }),
    },
  })

  // If the rule changed (or just became non-manual), re-run for all clients.
  const triggerChanged = parsed.data.triggerType !== undefined ||
    (nextValue !== undefined && nextValue !== owner.achievement.triggerValue)
  if (triggerChanged && updated.triggerType !== 'MANUAL') {
    evaluateAchievementForAllClients(updated).catch(() => {})
  }

  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ achievementId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { achievementId } = await ctx.params
  const owner = await ensureOwner(session.user.id, achievementId)
  if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.achievement.delete({ where: { id: achievementId } })
  return NextResponse.json({ ok: true })
}
