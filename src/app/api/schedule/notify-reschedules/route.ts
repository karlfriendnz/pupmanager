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
  // 1:1 with an activated client, OR a class with ≥1 activated member.
  OR: [
    { client: { is: activated } },
    { classRun: { is: { enrollments: { some: activatedEnroll } } } },
  ],
})

const fmt = (d: Date, tz: string) => d.toLocaleString('en-NZ', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
// "Puppy Foundations — session 2/6" → "Puppy Foundations"
const planTitle = (t: string) => t.replace(/\s+[—-]\s+session.*$/i, '').trim()

// GET — pending reschedules grouped by affected client (drives the banner list).
export async function GET() {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const pending = await prisma.trainingSession.findMany({
    where: pendingWhere(tid),
    select: {
      clientId: true, title: true,
      dog: { select: { name: true } },
      clientPackage: { select: { package: { select: { name: true } } } },
      client: { select: { userId: true, user: { select: { name: true, emailVerified: true } } } },
      classRunId: true,
      classRun: { select: { name: true, enrollments: { where: activatedEnroll, select: { client: { select: { userId: true, user: { select: { name: true } } } }, dog: { select: { name: true } } } } } },
    },
  })

  type Row = { userId: string; name: string; count: number; dogs: Set<string>; plans: Set<string> }
  const byUser = new Map<string, Row>()
  const ensure = (userId: string, name: string): Row => {
    let e = byUser.get(userId)
    if (!e) { e = { userId, name, count: 0, dogs: new Set(), plans: new Set() }; byUser.set(userId, e) }
    return e
  }
  for (const s of pending) {
    const plan = s.classRunId ? s.classRun?.name : (s.clientPackage?.package?.name ?? planTitle(s.title))
    if (s.clientId && s.client?.userId && s.client.user?.emailVerified) {
      const e = ensure(s.client.userId, s.client.user?.name ?? 'Client')
      e.count++
      if (s.dog?.name) e.dogs.add(s.dog.name)
      if (plan) e.plans.add(plan)
    } else if (s.classRunId) {
      for (const en of s.classRun?.enrollments ?? []) {
        if (!en.client?.userId) continue
        const e = ensure(en.client.userId, en.client.user?.name ?? 'Client')
        e.count++
        if (en.dog?.name) e.dogs.add(en.dog.name)
        if (plan) e.plans.add(plan)
      }
    }
  }
  const clients = [...byUser.values()].map(e => ({ userId: e.userId, name: e.name, count: e.count, dogs: [...e.dogs], plans: [...e.plans] }))
  return NextResponse.json({ sessions: pending.length, clients })
}

// POST — send the pending reschedules (optionally only to the chosen clients):
// one summary per client (their moved 1:1s + classes), then clear the flags.
// A class flag clears only once every enrolled member has been notified.
export async function POST(req: Request) {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const selected: Set<string> | null = Array.isArray(body?.clientUserIds) ? new Set(body.clientUserIds) : null

  // The sessions happen in the TRAINER's locale, so every client-facing time
  // renders in the trainer's timezone (never the server's UTC, and not the
  // individual client's device tz — the class is at one wall-clock time).
  const trainer = await prisma.trainerProfile.findUnique({ where: { id: tid }, select: { user: { select: { timezone: true } } } })
  const trainerTz = trainer?.user?.timezone ?? 'Pacific/Auckland'

  const pending = await prisma.trainingSession.findMany({
    where: pendingWhere(tid),
    select: {
      id: true, scheduledAt: true, title: true,
      clientId: true,
      client: { select: { userId: true, user: { select: { emailVerified: true } } } },
      dog: { select: { name: true } },
      classRunId: true,
      classRun: { select: { name: true, enrollments: { where: activatedEnroll, select: { client: { select: { userId: true } }, dog: { select: { name: true } } } } } },
    },
    orderBy: { scheduledAt: 'asc' },
  })

  type Item = { at: Date; title: string; dogName: string | null }
  const byUser = new Map<string, { items: Item[] }>()
  const push = (userId: string, item: Item) => {
    const e = byUser.get(userId) ?? { items: [] }
    e.items.push(item)
    byUser.set(userId, e)
  }
  const clearIds: string[] = []

  for (const s of pending) {
    const affected: string[] = []
    if (s.clientId && s.client?.userId && s.client.user?.emailVerified) {
      affected.push(s.client.userId)
      push(s.client.userId, { at: s.scheduledAt, title: s.title, dogName: s.dog?.name ?? null })
    } else if (s.classRunId) {
      for (const en of s.classRun?.enrollments ?? []) {
        if (!en.client?.userId) continue
        affected.push(en.client.userId)
        push(en.client.userId, { at: s.scheduledAt, title: s.classRun?.name ?? s.title, dogName: en.dog?.name ?? null })
      }
    }
    // Clear this session's flag only if everyone it affects is being notified.
    if (affected.length > 0 && (!selected || affected.every(uid => selected.has(uid)))) clearIds.push(s.id)
  }

  let notified = 0
  for (const [userId, { items }] of byUser) {
    const tz = trainerTz
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
