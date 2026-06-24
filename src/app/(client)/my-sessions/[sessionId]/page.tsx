import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import {
  SessionReport,
  reportBackgroundStyle,
  type ReportFormResponse,
  type ReportQuestion,
  type ReportAttachment,
} from '@/components/shared/session-report'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Session' }

type ReportTask = {
  id: string; title: string; description: string | null; repetitions: number | null
  videoUrl: string | null; imageUrls: string[]; trainerNote: string | null; completed: boolean
}

export default async function ClientSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const { sessionId } = await params

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { id: true, trainerId: true },
  })
  if (!profile) redirect('/login')

  let sessionTitle = ''
  let scheduledAt = new Date()
  let dogName: string | null = null
  let responses: ReportFormResponse[] = []
  let tasks: ReportTask[] = []
  let attachments: ReportAttachment[] = []
  let customFieldLabels = new Map<string, string>()
  let pendingMessage: string | null = null

  // 1:1 session (direct client link).
  const oneToOne = await prisma.trainingSession.findFirst({
    where: { id: sessionId, clientId: profile.id },
    include: {
      dog: { select: { name: true } },
      tasks: {
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, title: true, description: true, repetitions: true,
          videoUrl: true, imageUrls: true, trainerNote: true,
          completion: { select: { id: true } },
        },
      },
      attachments: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, kind: true, url: true, thumbnailUrl: true, caption: true, durationMs: true },
      },
      formResponses: {
        // Only sent recaps are visible to the client — drafts (sentAt null)
        // stay private to the trainer until they send.
        where: { sentAt: { not: null } },
        include: {
          form: { select: { id: true, name: true, introText: true, closingText: true, backgroundColor: true, backgroundUrl: true, questions: true } },
        },
      },
    },
  })

  if (oneToOne) {
    sessionTitle = oneToOne.title
    scheduledAt = oneToOne.scheduledAt
    dogName = oneToOne.dog?.name ?? null
    responses = oneToOne.formResponses.map(r => ({
      id: r.id,
      introMessage: r.introMessage,
      closingMessage: r.closingMessage,
      answers: (r.answers ?? {}) as Record<string, string>,
      form: { ...r.form, questions: Array.isArray(r.form.questions) ? r.form.questions as unknown as ReportQuestion[] : [] },
    }))
    tasks = oneToOne.tasks.map(t => ({
      id: t.id, title: t.title, description: t.description, repetitions: t.repetitions,
      videoUrl: t.videoUrl,
      imageUrls: Array.isArray(t.imageUrls) ? t.imageUrls.filter((s): s is string => typeof s === 'string') : [],
      trainerNote: t.trainerNote, completed: t.completion !== null,
    }))
    attachments = oneToOne.attachments.map((a): ReportAttachment => ({
      id: a.id, kind: a.kind as 'IMAGE' | 'VIDEO', url: a.url, thumbnailUrl: a.thumbnailUrl, caption: a.caption, durationMs: a.durationMs,
    }))
  } else {
    // Group-class session the client is enrolled in — their own write-up lives
    // on their attendance row, against the session's effective form.
    const cls = await prisma.trainingSession.findFirst({
      where: { id: sessionId, classRun: { enrollments: { some: { clientId: profile.id } } } },
      select: {
        title: true, scheduledAt: true, sessionFormId: true,
        classRun: { select: { name: true, package: { select: { defaultSessionFormId: true } } } },
        attendance: { where: { enrollment: { clientId: profile.id } }, take: 1, select: { report: true, reportSentAt: true } },
      },
    })
    if (!cls) notFound()

    sessionTitle = cls.classRun?.name ?? cls.title
    scheduledAt = cls.scheduledAt
    // Only a SENT report is visible — a saved draft (reportSentAt null) stays
    // private until the trainer sends it.
    const report = (cls.attendance[0]?.reportSentAt
      ? cls.attendance[0]?.report ?? null
      : null) as { answers?: Record<string, string>; intro?: string | null; closing?: string | null } | null
    const formId = cls.sessionFormId ?? cls.classRun?.package?.defaultSessionFormId ?? null
    const form = formId
      ? await prisma.sessionForm.findFirst({
          where: { id: formId, trainerId: profile.trainerId },
          select: { id: true, name: true, introText: true, closingText: true, backgroundColor: true, backgroundUrl: true, questions: true },
        })
      : null

    if (report && form) {
      responses = [{
        id: sessionId,
        introMessage: report.intro ?? null,
        closingMessage: report.closing ?? null,
        answers: report.answers ?? {},
        form: { ...form, questions: Array.isArray(form.questions) ? form.questions as unknown as ReportQuestion[] : [] },
      }]
    } else {
      pendingMessage = 'Your trainer hasn’t written up this session yet — check back after the class.'
    }
  }

  const linkedIds = responses.flatMap(r =>
    r.form.questions.filter(q => q.type === 'CUSTOM_FIELD').map(q => (q as { customFieldId: string }).customFieldId)
  )
  if (linkedIds.length > 0) {
    const linkedFields = await prisma.customField.findMany({
      where: { trainerId: profile.trainerId, id: { in: linkedIds } },
      select: { id: true, label: true },
    })
    customFieldLabels = new Map(linkedFields.map(f => [f.id, f.label]))
  }

  return (
    <div className="min-h-[100dvh] w-full" style={reportBackgroundStyle(responses)}>
      <div className="px-5 lg:px-8 py-6 max-w-3xl mx-auto">
        <Link href="/home" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>

        {pendingMessage ? (
          <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-8 text-center">
            <h1 className="font-display text-xl font-bold text-slate-900">{sessionTitle}</h1>
            <p className="mt-1 text-sm text-slate-500">{scheduledAt.toLocaleString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
            <p className="mt-4 text-sm text-slate-400">{pendingMessage}</p>
          </div>
        ) : (
          <SessionReport
            sessionTitle={sessionTitle}
            scheduledAt={scheduledAt}
            dogName={dogName}
            formResponses={responses}
            tasks={tasks}
            attachments={attachments}
            customFieldLabels={customFieldLabels}
          />
        )}
      </div>
    </div>
  )
}
