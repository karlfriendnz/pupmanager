import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notifyClient } from '@/lib/client-notify'
import { z } from 'zod'

// A TRAINER replies to one of a client's practice logs — a single editable
// comment per log. This closes the feedback loop: the client sees the reply
// under that entry in their homework history and gets notified.
//
// Security: only a signed-in TRAINER may comment, and only on a log whose task
// belongs to a company the trainer is a MEMBER of. We resolve the log → task →
// client's owning company (trainerId), then require a TrainerMembership row for
// (user, company). No membership → 404 (indistinguishable from "no such log").

const schema = z.object({
  comment: z.string().trim().min(1).max(2000),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ logId: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { logId } = await params
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const log = await prisma.trainingLog.findUnique({
    where: { id: logId },
    select: {
      id: true,
      task: {
        select: {
          id: true,
          title: true,
          client: {
            select: {
              userId: true,
              trainerId: true,
              trainer: { select: { businessName: true, user: { select: { name: true } } } },
            },
          },
        },
      },
    },
  })
  if (!log) return NextResponse.json({ error: 'Log not found' }, { status: 404 })

  // The acting trainer must be a member of the company that owns this client.
  const companyId = log.task.client.trainerId
  const membership = await prisma.trainerMembership.findFirst({
    where: { userId: session.user.id, companyId },
    select: { id: true },
  })
  if (!membership) return NextResponse.json({ error: 'Log not found' }, { status: 404 })

  const updated = await prisma.trainingLog.update({
    where: { id: logId },
    data: { trainerComment: parsed.data.comment, trainerCommentAt: new Date() },
    select: { id: true, trainerComment: true, trainerCommentAt: true },
  })

  // Notify the client their trainer replied. Branded to the client's company.
  const trainerName =
    log.task.client.trainer?.businessName ??
    log.task.client.trainer?.user?.name ??
    'Your trainer'
  await notifyClient({
    userId: log.task.client.userId,
    trainerId: companyId,
    type: 'TRAINER_COMMENTED_LOG',
    vars: { trainerName, taskTitle: log.task.title },
    link: `/my-homework/${log.task.id}`,
  })

  return NextResponse.json(updated)
}
