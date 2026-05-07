import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Clock, MapPin, Video } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import {
  SessionReport,
  reportBackgroundStyle,
  type ReportFormResponse,
  type ReportQuestion,
} from '@/components/shared/session-report'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Session' }

export default async function ClientSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const { sessionId } = await params

  // Resolve the calling client's profile so we can scope the session lookup
  // to their own records (no cross-client leakage). Trainer-in-preview gets
  // their previewed client here via getActiveClient.
  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { id: true, trainerId: true },
  })
  if (!profile) redirect('/login')

  const trainingSession = await prisma.trainingSession.findFirst({
    where: { id: sessionId, clientId: profile.id },
    include: {
      dog: { select: { name: true } },
      trainer: { select: { businessName: true, user: { select: { name: true } } } },
      tasks: {
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, title: true, description: true, repetitions: true,
          videoUrl: true, trainerNote: true,
          completion: { select: { id: true } },
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
        where: { trainerId: profile.trainerId, id: { in: linkedIds } },
        select: { id: true, label: true },
      })
    : []
  const customFieldLabels = new Map(linkedFields.map(f => [f.id, f.label]))

  const start = trainingSession.scheduledAt
  const isUpcoming = start.getTime() > Date.now()

  return (
    <div className="min-h-[100dvh] w-full" style={reportBackgroundStyle(responses)}>
      <div className="px-5 lg:px-8 py-6 max-w-3xl mx-auto">
        <Link
          href="/home"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        {/* When/where strip — visible regardless of whether a report exists.
            Helps the client orient before scrolling into the report content. */}
        <div className="mb-6 rounded-2xl bg-white/90 backdrop-blur border border-slate-100 p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            <span>
              {start.toLocaleString('en-NZ', {
                weekday: 'long', day: 'numeric', month: 'long',
                hour: 'numeric', minute: '2-digit',
              })}
              {' · '}
              {trainingSession.durationMins} min
            </span>
          </div>
          {trainingSession.sessionType === 'VIRTUAL' ? (
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <Video className="h-3.5 w-3.5 text-slate-400" />
              {trainingSession.virtualLink && isUpcoming ? (
                <a href={trainingSession.virtualLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  Join virtual session
                </a>
              ) : (
                <span>Virtual session</span>
              )}
            </div>
          ) : trainingSession.location && (
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <MapPin className="h-3.5 w-3.5 text-slate-400" />
              <span>{trainingSession.location}</span>
            </div>
          )}
          <p className="text-xs text-slate-400">
            with {trainingSession.trainer.user.name ?? trainingSession.trainer.businessName}
          </p>
        </div>

        <SessionReport
          sessionTitle={trainingSession.title}
          scheduledAt={trainingSession.scheduledAt}
          dogName={trainingSession.dog?.name ?? null}
          formResponses={responses}
          tasks={trainingSession.tasks.map(t => ({
            id: t.id,
            title: t.title,
            description: t.description,
            repetitions: t.repetitions,
            videoUrl: t.videoUrl,
            trainerNote: t.trainerNote,
            completed: t.completion !== null,
          }))}
          customFieldLabels={customFieldLabels}
        />
      </div>
    </div>
  )
}
