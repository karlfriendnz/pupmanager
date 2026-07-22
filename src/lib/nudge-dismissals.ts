import { prisma } from './prisma'

// "Not now" on an add-on nudge used to be a localStorage flag, so the nudge
// came straight back on the trainer's phone, their other browser, or after a
// cache clear. These helpers persist the choice per user instead.
//
// localStorage is still written on dismiss as a fast path (it suppresses the
// nudge instantly on the current device without waiting for a round trip);
// this table is the durable record the server renders from.

/** Every nudge id this user has dismissed. */
export async function getDismissedNudgeIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.nudgeDismissal.findMany({
    where: { userId },
    select: { nudgeId: true },
  })
  return new Set(rows.map(r => r.nudgeId))
}

/** Has this user dismissed one specific nudge? */
export async function isNudgeDismissed(userId: string, nudgeId: string): Promise<boolean> {
  const row = await prisma.nudgeDismissal.findUnique({
    where: { userId_nudgeId: { userId, nudgeId } },
    select: { id: true },
  })
  return !!row
}

/** Record a dismissal. Idempotent — re-dismissing keeps the original time. */
export async function dismissNudge(userId: string, nudgeId: string): Promise<void> {
  await prisma.nudgeDismissal.upsert({
    where: { userId_nudgeId: { userId, nudgeId } },
    create: { userId, nudgeId },
    update: {},
  })
}
