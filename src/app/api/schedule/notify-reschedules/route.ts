import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notifyClient } from '@/lib/client-notify'

async function trainerId() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) return null
  return session.user.trainerId
}

// Only notify clients who've set up their account (emailVerified). For a 1:1
// session that's the session's client; for a class it's every enrolled,
// activated member.
const activated = { user: { emailVerified: { not: null } } }
const activatedEnroll = { status: 'ENROLLED' as const, client: { is: activated } }
const pendingWhere = (tid: string) => ({
  trainerId: tid,
  rescheduleNotifyPendingAt: { not: null },
  scheduledAt: { gt: new Date() },
  // 1:1 with an activated client, OR any class session (members resolved below).
  OR: [{ client: { is: activated } }, { classRunId: { not: null } }],
})

const fmt = (d: Date, tz: string) => d.toLocaleString('en-NZ', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

// GET — pending reschedules grouped by affected client (drives the banner list).
export async function GET() {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const pending = await prisma.trainingSession.findMany({
    where: pendingWhere(tid),
    select: {
      clientId: true,
      client: { select: { userId: true, user: { select: { name: true, emailVerified: true } } } },
      classRunId: true,
      classRun: { select: { enrollments: { where: activatedEnroll, select: { client: { select: { userId: true, user: { select: { name: true } } } } } } } },
    },
  })
  const byUser = new Map<string, { userId: string; name: string; count: number }>()
  const add = (userId: string, name: string) => {
    const e = byUser.get(userId) ?? { userId, name, count: 0 }
    e.count++
    byUser.set(userId, e)
  }
  for (const s of pending) {
    if (s.clientId && s.client?.userId && s.client.user?.emailVerified) {
      add(s.client.userId, s.client.user?.name ?? 'Client')
    } else if (s.classRunId) {
      for (const en of s.classRun?.enrollments ?? []) {
        if (en.client?.userId) add(en.client.userId, en.client.user?.name ?? 'Client')
      }
    }
  }
  return NextResponse.json({ sessions: pending.length, clients: [...byUser.values()] })
}

// POST — send the pending reschedules (optionally only to the chosen clients):
// one summary per client (their moved 1:1s + classes), then clear the flags.
// A class flag clears only once every enrolled member has been notified.
export async function POST(req: Request) {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const selected: Set<string> | null = Array.isArray(body?.clientUserIds) ? new Set(body.clientUserIds) : null

  const pending = await prisma.trainingSession.findMany({
    where: pendingWhere(tid),
    select: {
      id: true, scheduledAt: true, title: true,
      clientId: true,
      client: { select: { userId: true, user: { select: { timezone: true, emailVerified: true } } } },
      dog: { select: { name: true } },
      classRunId: true,
      classRun: { select: { name: true, enrollments: { where: activatedEnroll, select: { client: { select: { userId: true, user: { select: { timezone: true } } } }, dog: { select: { name: true } } } } } },
    },
    orderBy: { scheduledAt: 'asc' },
  })

  type Item = { at: Date; title: string; dogName: string | null }
  const byUser = new Map<string, { tz: string; items: Item[] }>()
  const push = (userId: string, tz: string | null, item: Item) => {
    const e = byUser.get(userId) ?? { tz: tz ?? 'Pacific/Auckland', items: [] }
    e.items.push(item)
    byUser.set(userId, e)
  }
  const clearIds: string[] = []

  for (const s of pending) {
    const affected: string[] = []
    if (s.clientId && s.client?.userId && s.client.user?.emailVerified) {
      affected.push(s.client.userId)
      push(s.client.userId, s.client.user?.timezone ?? null, { at: s.scheduledAt, title: s.title, dogName: s.dog?.name ?? null })
    } else if (s.classRunId) {
      for (const en of s.classRun?.enrollments ?? []) {
        if (!en.client?.userId) continue
        affected.push(en.client.userId)
        push(en.client.userId, en.client.user?.timezone ?? null, { at: s.scheduledAt, title: s.classRun?.name ?? s.title, dogName: en.dog?.name ?? null })
      }
    }
    // Clear this session's flag only if everyone it affects is being notified.
    if (affected.length > 0 && (!selected || affected.every(uid => selected.has(uid)))) clearIds.push(s.id)
  }

  let notified = 0
  for (const [userId, { tz, items }] of byUser) {
    if (selected && !selected.has(userId)) continue
    items.sort((a, b) => a.at.getTime() - b.at.getTime())
    const dogName = items.find(i => i.dogName)?.dogName ?? 'your dog'
    const detail = items.length === 1 ? `Moved to ${fmt(items[0].at, tz)}` : `${items.length} sessions rescheduled`
    await notifyClient({
      userId, trainerId: tid, type: 'CLIENT_SESSION_CHANGED',
      vars: { dogName, planName: items.length === 1 ? items[0].title : 'Your sessions', detail },
      link: '/my-sessions', ctaLabel: 'View sessions',
      sessions: items.length > 1 ? items.map(i => ({ when: fmt(i.at, tz) })) : undefined,
    })
    notified++
  }

  if (clearIds.length > 0) {
    await prisma.trainingSession.updateMany({ where: { id: { in: clearIds } }, data: { rescheduleNotifyPendingAt: null } })
  }

  return NextResponse.json({ ok: true, clients: notified, sessions: clearIds.length })
}

// DELETE — dismiss every pending reschedule without telling anyone.
export async function DELETE() {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const res = await prisma.trainingSession.updateMany({
    where: pendingWhere(tid),
    data: { rescheduleNotifyPendingAt: null },
  })
  return NextResponse.json({ ok: true, cleared: res.count })
}
