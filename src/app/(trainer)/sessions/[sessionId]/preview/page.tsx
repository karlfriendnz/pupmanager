import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { ArrowLeft, Eye } from 'lucide-react'
import {
  SessionReport,
  reportBackgroundStyle,
  type ReportFormResponse,
  type ReportQuestion,
} from '@/components/shared/session-report'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Session report preview' }

export default async function SessionPreviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const { sessionId } = await params

  const trainingSession = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId },
    include: {
      client: { select: { user: { select: { name: true } } } },
      dog: { select: { name: true } },
      tasks: {
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, title: true, description: true, repetitions: true,
          videoUrl: true, trainerNote: true, imageUrls: true,
        },
      },
      formResponses: {
        include: {
          form: { select: {
            id: true, name: true, introText: true, closingText: true,
            backgroundColor: true, backgroundUrl: true, questions: true,
          } },
        },
      },
    },
  })
  if (!trainingSession) notFound()

  const responses: ReportFormResponse[] = trainingSession.formResponses.map(r => ({
    id: r.id,
    introMessage: r.introMessage,
    closingMessage: r.closingMessage,
    answers: (r.answers ?? {}) as Record<string, string>,
    form: {
      ...r.form,
      questions: Array.isArray(r.form.questions)
        ? r.form.questions as unknown as ReportQuestion[]
        : [],
    },
  }))

  const linkedIds = responses.flatMap(r =>
    r.form.questions.filter(q => q.type === 'CUSTOM_FIELD').map(q => (q as { customFieldId: string }).customFieldId)
  )
  const linkedFields = linkedIds.length > 0
    ? await prisma.customField.findMany({
        where: { trainerId, id: { in: linkedIds } },
        select: { id: true, label: true },
      })
    : []
  const customFieldLabels = new Map(linkedFields.map(f => [f.id, f.label]))

  return (
    <div className="min-h-screen w-full" style={reportBackgroundStyle(responses)}>
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <Link
            href={`/sessions/${trainingSession.id}`}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to session
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">
            <Eye className="h-3.5 w-3.5" /> Preview — what your client sees
          </span>
        </div>

        <SessionReport
          sessionTitle={trainingSession.title}
          scheduledAt={trainingSession.scheduledAt}
          clientName={trainingSession.client?.user.name ?? null}
          dogName={trainingSession.dog?.name ?? null}
          formResponses={responses}
          tasks={trainingSession.tasks.map(t => ({
            id: t.id,
            title: t.title,
            description: t.description,
            repetitions: t.repetitions,
            videoUrl: t.videoUrl,
            trainerNote: t.trainerNote,
            // No completion column in trainer preview — keeps it visually clean.
          }))}
          customFieldLabels={customFieldLabels}
        />
      </div>
    </div>
  )
}
