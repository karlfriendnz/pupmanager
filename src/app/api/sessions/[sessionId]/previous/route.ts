import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * The last few write-ups for whoever this session belongs to.
 *
 * The session's own PAGE already loads these server-side. The calendar's
 * popover can't: it is a client component that only knows the session it was
 * opened on, and Karl wants previous notes readable there without leaving the
 * calendar ("the first tab is the details of the dog and the owner… below that
 * should be the previous notes button").
 *
 * Same query as the page, deliberately — five most recent, past only, and only
 * sessions that actually happened, so an upcoming booking never shows up as
 * "previous". If the two ever need to differ, that is a decision to make on
 * purpose rather than by drift.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const session = await auth()
  const trainerId = session?.user?.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { sessionId } = await params

  // Scoped to the signed-in company: the id arrives from the client, so this
  // is the tenant guard, not a convenience. A session belonging to another
  // trainer reads as "not found" rather than confirming it exists.
  const current = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId },
    select: { id: true, clientId: true, scheduledAt: true },
  })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!current.clientId) return NextResponse.json({ items: [] })

  const rows = await prisma.trainingSession.findMany({
    where: {
      clientId: current.clientId,
      trainerId,
      id: { not: current.id },
      scheduledAt: { lte: current.scheduledAt },
      status: { in: ['COMPLETED', 'COMMENTED', 'INVOICED'] },
    },
    orderBy: { scheduledAt: 'desc' },
    take: 5,
    select: {
      id: true,
      title: true,
      scheduledAt: true,
      formResponses: {
        select: {
          introMessage: true,
          closingMessage: true,
          answers: true,
          form: { select: { name: true, questions: true } },
        },
      },
    },
  })

  return NextResponse.json({
    items: rows.map(r => ({
      id: r.id,
      title: r.title,
      scheduledAt: r.scheduledAt.toISOString(),
      // Flattened to what the popover draws: a label and the answer. Sending
      // the raw form JSON would make the client re-derive the question order,
      // which is exactly the sort of thing that drifts between two screens.
      entries: r.formResponses.flatMap(fr => {
        const answers = (fr.answers ?? {}) as Record<string, string>
        const questions = Array.isArray(fr.form.questions)
          ? (fr.form.questions as { id: string; label?: string }[])
          : []
        return [
          ...(fr.introMessage ? [{ label: null, value: fr.introMessage, italic: true }] : []),
          ...questions
            .filter(q => answers[q.id])
            .map(q => ({ label: q.label ?? 'Answer', value: String(answers[q.id]), italic: false })),
          ...(fr.closingMessage ? [{ label: null, value: fr.closingMessage, italic: true }] : []),
        ]
      }),
    })),
  })
}
