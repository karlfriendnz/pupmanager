import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendPush } from '@/lib/push'

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') return null
  return session
}

// Broadcast a DRAFT announcement to every trainer's notification bell.
//
// The bell reads the Notification table, so we fan out one row per recipient
// User — "all trainer team members" = every accepted TrainerMembership user
// (owners + staff), de-duplicated across companies. We also push to phones for
// recipients who have push on. Push is best-effort: the in-app rows are the
// source of truth and must not be rolled back if a provider hiccups.
//
// Scale note: at today's trainer count this is a single createMany + a short
// push loop. If the trainer base grows into the thousands, move the push loop
// to a queue/cron so the request stays fast.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params

  const announcement = await prisma.announcement.findUnique({ where: { id } })
  if (!announcement) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (announcement.status === 'SENT') {
    return NextResponse.json({ error: 'This announcement has already been sent.' }, { status: 409 })
  }

  // Recipients depend on the announcement's audience. Collect into a Set so a
  // user who is BOTH a trainer and a client (of some other business) still gets
  // exactly one notification when the audience is EVERYONE. A missing audience
  // (legacy rows) falls back to trainers-only.
  const audience = announcement.audience ?? 'ALL_TRAINERS'
  const wantsTrainers = audience === 'ALL_TRAINERS' || audience === 'EVERYONE'
  const wantsClients = audience === 'ALL_CLIENTS' || audience === 'EVERYONE'

  const userIdSet = new Set<string>()

  if (wantsTrainers) {
    // Every accepted trainer-side team member, de-duplicated (a user can belong
    // to more than one company but should only get one notification).
    const members = await prisma.trainerMembership.findMany({
      where: { acceptedAt: { not: null } },
      select: { userId: true },
      distinct: ['userId'],
    })
    for (const m of members) userIdSet.add(m.userId)
  }

  if (wantsClients) {
    // Every real client (dog owner) with an account. Sample/preview clients
    // seeded by the personalization wizard are excluded — they aren't people.
    const clients = await prisma.clientProfile.findMany({
      where: { isSample: false },
      select: { userId: true },
      distinct: ['userId'],
    })
    for (const c of clients) userIdSet.add(c.userId)
  }

  const userIds = [...userIdSet]

  // Fan out the in-app rows (the bell + /notifications + live badge read these).
  if (userIds.length > 0) {
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: 'PLATFORM_ANNOUNCEMENT' as const,
        title: announcement.title,
        body: announcement.body,
        link: announcement.link,
      })),
    })
  }

  // Mark sent BEFORE the push loop so a slow/failing push can never re-open the
  // announcement for a duplicate send.
  await prisma.announcement.update({
    where: { id },
    data: { status: 'SENT', sentAt: new Date(), recipientCount: userIds.length },
  })

  // Push to phones — only recipients who haven't turned push off globally.
  if (userIds.length > 0) {
    const pushable = await prisma.user.findMany({
      where: { id: { in: userIds }, notifyPush: true },
      select: { id: true },
    })
    await Promise.allSettled(
      pushable.map((u) =>
        sendPush(u.id, {
          alert: { title: announcement.title, body: announcement.body },
          customData: { type: 'PLATFORM_ANNOUNCEMENT', path: announcement.link ?? '/notifications' },
        }),
      ),
    )
  }

  return NextResponse.json({ ok: true, recipientCount: userIds.length })
}
