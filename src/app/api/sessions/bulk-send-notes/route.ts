import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notifyClient } from '@/lib/client-notify'
import { z } from 'zod'

const schema = z.object({
  // 1:1 session notes (SessionFormResponse ids).
  responseIds: z.array(z.string()).max(500).optional(),
  // Group-class per-attendee reports (SessionAttendance ids).
  attendanceIds: z.array(z.string()).max(500).optional(),
})

// Send saved DRAFT notes. Stamps sentAt / reportSentAt (which both reveals the
// recap to the client and records the send), then fires the "your recap is
// ready" notification (push + in-app + email). Handles a single id or many, so
// it powers both the per-note Send button and Send all. Only drafts are
// affected — anything already sent is skipped, so re-sending can't double-notify.
export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const responseIds = parsed.data.responseIds ?? []
  const attendanceIds = parsed.data.attendanceIds ?? []
  if (responseIds.length === 0 && attendanceIds.length === 0) {
    return NextResponse.json({ error: 'Nothing to send' }, { status: 400 })
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { businessName: true, user: { select: { name: true } } },
  })
  const trainerName = trainer?.user?.name ?? trainer?.businessName ?? 'Your trainer'

  const now = new Date()
  let sent = 0

  // ── 1:1 session notes ──────────────────────────────────────────────────
  if (responseIds.length > 0) {
    const drafts = await prisma.sessionFormResponse.findMany({
      where: { id: { in: responseIds }, sentAt: null, session: { trainerId } },
      select: {
        id: true,
        sessionId: true,
        session: {
          select: {
            title: true,
            dog: { select: { name: true } },
            client: { select: { userId: true } },
          },
        },
      },
    })
    if (drafts.length > 0) {
      await prisma.sessionFormResponse.updateMany({
        where: { id: { in: drafts.map(d => d.id) } },
        data: { sentAt: now },
      })
      for (const d of drafts) {
        sent++
        if (!d.session.client?.userId) continue
        await notifyClient({
          userId: d.session.client.userId,
          trainerId,
          type: 'CLIENT_RECAP_READY',
          vars: { trainerName, dogName: d.session.dog?.name ?? 'your dog', planName: d.session.title },
          link: `/my-sessions/${d.sessionId}`,
          ctaLabel: 'See your recap',
        })
      }
    }
  }

  // ── Group-class per-attendee reports ───────────────────────────────────
  if (attendanceIds.length > 0) {
    const rows = await prisma.sessionAttendance.findMany({
      where: { id: { in: attendanceIds }, reportSentAt: null, session: { classRun: { trainerId } } },
      select: {
        id: true,
        sessionId: true,
        report: true,
        enrollment: {
          select: {
            client: { select: { userId: true } },
            dog: { select: { name: true } },
            classRun: { select: { name: true } },
          },
        },
      },
    })
    // Only send rows that actually have a written report.
    const drafts = rows.filter(r => r.report != null)
    if (drafts.length > 0) {
      await prisma.sessionAttendance.updateMany({
        where: { id: { in: drafts.map(d => d.id) } },
        data: { reportSentAt: now },
      })
      for (const d of drafts) {
        sent++
        if (!d.enrollment.client?.userId) continue
        await notifyClient({
          userId: d.enrollment.client.userId,
          trainerId,
          type: 'CLIENT_RECAP_READY',
          vars: {
            trainerName,
            dogName: d.enrollment.dog?.name ?? 'your dog',
            planName: d.enrollment.classRun?.name ?? 'your class',
          },
          link: `/my-sessions/${d.sessionId}`,
          ctaLabel: 'See your recap',
        })
      }
    }
  }

  return NextResponse.json({ sent })
}
