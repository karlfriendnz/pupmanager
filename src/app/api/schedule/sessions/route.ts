import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Create a single ad-hoc TrainingSession that isn't tied to a package or class —
// used by the "buddies walk" flow on the schedule (a group walk with several
// dogs). The first attendee is the session's primary client/dog; the rest are
// attached as SessionBuddy rows (the same model the session modal uses to add
// buddies onto an existing session).
const attendee = z.object({
  clientId: z.string().min(1),
  dogId: z.string().min(1).nullable().optional(),
})

const schema = z.object({
  scheduledAt: z.string().datetime(),
  durationMins: z.number().int().min(5).max(600).default(60),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']).default('IN_PERSON'),
  title: z.string().min(1).max(120).default('Group walk'),
  location: z.string().max(200).nullable().optional(),
  attendees: z.array(attendee).min(1).max(20),
  // Recurrence: repeat every `weeksBetween` weeks for `occurrences` walks.
  weeksBetween: z.number().int().min(1).max(8).default(1),
  occurrences: z.number().int().min(1).max(52).default(1),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { scheduledAt, durationMins, sessionType, title, location, attendees, weeksBetween, occurrences } = parsed.data

  // Every attendee client must belong to this trainer.
  const clientIds = [...new Set(attendees.map(a => a.clientId))]
  const owned = await prisma.clientProfile.findMany({
    where: { id: { in: clientIds }, trainerId },
    select: { id: true, assignedMembershipId: true },
  })
  if (owned.length !== clientIds.length) {
    return NextResponse.json({ error: 'One or more clients not found' }, { status: 404 })
  }

  const [primary, ...rest] = attendees
  const assignedMembershipId = owned.find(o => o.id === primary.clientId)?.assignedMembershipId ?? null

  // Buddies = the remaining attendees, deduped (and never the primary again).
  const seen = new Set<string>([`${primary.clientId}:${primary.dogId ?? ''}`])
  const buddyList: { clientId: string; dogId: string | null }[] = []
  for (const b of rest) {
    const key = `${b.clientId}:${b.dogId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    buddyList.push({ clientId: b.clientId, dogId: b.dogId ?? null })
  }

  // One series id ties the recurring walks together so a dog can later be added
  // to this walk / this + following / the whole series. Single walks get none
  // (no "subsequent walks" exist, so the scope chooser would be noise).
  const walkSeriesId = occurrences > 1 ? randomUUID() : null
  const base = new Date(scheduledAt)
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000

  const createdIds = await prisma.$transaction(async tx => {
    const ids: string[] = []
    for (let i = 0; i < occurrences; i++) {
      const s = await tx.trainingSession.create({
        data: {
          trainerId,
          clientId: primary.clientId,
          dogId: primary.dogId ?? null,
          assignedMembershipId,
          title,
          scheduledAt: new Date(base.getTime() + i * weeksBetween * WEEK_MS),
          durationMins,
          sessionType,
          location: location?.trim() || null,
          walkSeriesId,
        },
      })
      ids.push(s.id)
      if (buddyList.length) {
        await tx.sessionBuddy.createMany({
          data: buddyList.map(b => ({ sessionId: s.id, clientId: b.clientId, dogId: b.dogId })),
        })
      }
    }
    return ids
  })
  const firstId = createdIds[0] ?? ''

  // Best-effort: mirror the new walk(s) onto the trainer's Google Calendar.
  // Awaited (not fire-and-forget) but wrapped so it never breaks creation.
  try {
    const { syncSessionsToGoogle } = await import('@/lib/google-calendar')
    await syncSessionsToGoogle(createdIds)
  } catch {
    // Non-critical
  }

  return NextResponse.json({ id: firstId, walkSeriesId, occurrences })
}
