import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notifyClient } from '@/lib/client-notify'

async function trainerId() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) return null
  return session.user.trainerId
}

const pendingWhere = (tid: string) => ({
  trainerId: tid,
  rescheduleNotifyPendingAt: { not: null },
  scheduledAt: { gt: new Date() },
  clientId: { not: null },
})

// GET — the pending reschedules grouped by client (drives the banner list).
export async function GET() {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const pending = await prisma.trainingSession.findMany({
    where: pendingWhere(tid),
    select: { client: { select: { userId: true, user: { select: { name: true } } } }, dog: { select: { name: true } } },
  })
  const byUser = new Map<string, { userId: string; name: string; count: number }>()
  for (const p of pending) {
    const uid = p.client?.userId
    if (!uid) continue
    const e = byUser.get(uid) ?? { userId: uid, name: p.client?.user?.name ?? 'Client', count: 0 }
    e.count++
    byUser.set(uid, e)
  }
  return NextResponse.json({ sessions: pending.length, clients: [...byUser.values()] })
}

// POST — send the pending reschedules (optionally only to the chosen clients):
// one summary per client, then clear those flags. Unselected stay pending.
export async function POST(req: Request) {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const selected: string[] | null = Array.isArray(body?.clientUserIds) ? body.clientUserIds : null

  const pending = await prisma.trainingSession.findMany({
    where: selected ? { ...pendingWhere(tid), client: { userId: { in: selected } } } : pendingWhere(tid),
    select: {
      id: true, scheduledAt: true, title: true,
      client: { select: { userId: true, user: { select: { timezone: true } } } },
      dog: { select: { name: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  })

  const byClient = new Map<string, typeof pending>()
  for (const s of pending) {
    const uid = s.client?.userId
    if (!uid) continue
    const arr = byClient.get(uid) ?? []
    arr.push(s)
    byClient.set(uid, arr)
  }

  for (const [userId, group] of byClient) {
    const tz = group[0].client?.user?.timezone ?? 'Pacific/Auckland'
    const fmt = (d: Date) => d.toLocaleString('en-NZ', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    const dogName = group.find(g => g.dog?.name)?.dog?.name ?? 'your dog'
    const detail = group.length === 1 ? `Moved to ${fmt(group[0].scheduledAt)}` : `${group.length} sessions rescheduled`
    await notifyClient({
      userId, trainerId: tid, type: 'CLIENT_SESSION_CHANGED',
      vars: { dogName, planName: group.length === 1 ? group[0].title : 'Your sessions', detail },
      link: '/my-sessions', ctaLabel: 'View sessions',
      sessions: group.length > 1 ? group.map(g => ({ when: fmt(g.scheduledAt) })) : undefined,
    })
  }

  await prisma.trainingSession.updateMany({
    where: { id: { in: pending.map(p => p.id) } },
    data: { rescheduleNotifyPendingAt: null },
  })

  return NextResponse.json({ ok: true, clients: byClient.size, sessions: pending.length })
}

// DELETE — dismiss without telling anyone. Optionally only the chosen clients.
export async function DELETE(req: Request) {
  const tid = await trainerId()
  if (!tid) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const selected: string[] | null = Array.isArray(body?.clientUserIds) ? body.clientUserIds : null
  const res = await prisma.trainingSession.updateMany({
    where: selected ? { ...pendingWhere(tid), client: { userId: { in: selected } } } : pendingWhere(tid),
    data: { rescheduleNotifyPendingAt: null },
  })
  return NextResponse.json({ ok: true, cleared: res.count })
}
