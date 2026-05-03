import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { z } from 'zod'

// GET — returns the trainer's achievement catalogue with award status for this
// client (so the trainer profile can show earned + remaining auto-rules).
export async function GET(_req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const { clientId } = await ctx.params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [achievements, awards] = await Promise.all([
    prisma.achievement.findMany({
      where: { trainerId: access.client.trainerId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.clientAchievement.findMany({
      where: { clientId },
      select: { achievementId: true, awardedAt: true, awardedBy: true, earnedValue: true },
    }),
  ])
  const awardMap = new Map(awards.map(a => [a.achievementId, a]))

  return NextResponse.json({
    achievements: achievements.map(a => ({
      ...a,
      earned: awardMap.has(a.id),
      award: awardMap.get(a.id) ?? null,
    })),
  })
}

const awardSchema = z.object({
  achievementId: z.string().min(1),
})

// POST — trainer manually awards a MANUAL achievement to this client.
// Auto-rule achievements are not awardable by hand — the engine owns those.
export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const { clientId } = await ctx.params
  const access = await getClientAccess(clientId, session.user.id)
  if (!access || !access.canEdit) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = awardSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const achievement = await prisma.achievement.findUnique({
    where: { id: parsed.data.achievementId },
    select: { id: true, trainerId: true, triggerType: true, name: true },
  })
  if (!achievement || achievement.trainerId !== access.client.trainerId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (achievement.triggerType !== 'MANUAL') {
    return NextResponse.json({ error: 'Auto-awarded achievements are managed by the system' }, { status: 400 })
  }

  // Get the client's user id so we can drop a notification on the inbox.
  const clientUser = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: { userId: true },
  })

  const award = await prisma.clientAchievement.upsert({
    where: { clientId_achievementId: { clientId, achievementId: achievement.id } },
    create: {
      clientId,
      achievementId: achievement.id,
      awardedBy: session.user.id,
    },
    update: {},
  })

  if (clientUser) {
    await prisma.notification.create({
      data: {
        userId: clientUser.userId,
        title: 'Achievement unlocked',
        body: `You earned "${achievement.name}"`,
      },
    }).catch(() => {})
  }

  return NextResponse.json(award, { status: 201 })
}
