import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { NOT_SUSPENDED, SESSIONS_NOT_SUSPENDED } from '@/lib/membership-access'
import { getActiveClient } from '@/lib/client-context'
import {
  SessionReport,
  reportBackgroundStyle,
  type ReportFormResponse,
  type ReportQuestion,
  type ReportAttachment,
} from '@/components/shared/session-report'
import { RichText } from '@/components/shared/rich-text'
import { isRichTextEmpty } from '@/lib/rich-text'
import { resolveSeriesSteps, stepForIndex, type CurriculumStep } from '@/lib/series'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Session' }

type ReportTask = {
  id: string; title: string; description: string | null; repetitions: number | null
  videoUrl: string | null; imageUrls: string[]; trainerNote: string | null; completed: boolean
}

/** The curriculum, smallest shape that answers "what are we covering". */
const PLAN_SELECT = {
  orderBy: { sessionIndex: 'asc' },
  select: { id: true, sessionIndex: true, title: true, description: true },
} as const

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
    // trainer.user.timezone: sessions happen in the TRAINER's locale, and this
    // is a server component — an unqualified toLocaleString formats in the
    // server's zone (UTC on Vercel), turning a 6:00pm class into 6:00am.
    select: { id: true, trainerId: true, trainer: { select: { user: { select: { timezone: true } } } } },
  })
  if (!profile) redirect('/login')
  const tz = profile.trainer?.user?.timezone ?? 'Pacific/Auckland'

  let sessionTitle = ''
  let scheduledAt = new Date()
  let dogName: string | null = null
  let responses: ReportFormResponse[] = []
  let tasks: ReportTask[] = []
  let attachments: ReportAttachment[] = []
  let customFieldLabels = new Map<string, string>()
  let pendingMessage: string | null = null
  // What this session covers, when the offering runs a curriculum. Written by
  // the trainer on the offering's Sessions tab, and client-facing by design —
  // it is the plan for THEIR session, which is most useful BEFORE it happens.
  let step: CurriculumStep | null = null

  // 1:1 session (direct client link).
  const oneToOne = await prisma.trainingSession.findFirst({
    // Also the AUTHORISATION check for this page, so the suspension filter
    // belongs here too: a paused membership must not still open its write-ups.
    where: { id: sessionId, clientId: profile.id, ...SESSIONS_NOT_SUSPENDED },
    include: {
      clientPackage: {
        select: { package: { select: { isSeries: true, sessionPlans: PLAN_SELECT } } },
      },
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
    // On a 1:1 series the step is STORED, not counted: the trainer may have
    // skipped one for this dog, so the client's 2nd session can be step 3.
    // Resolved through the same lib the trainer's screen uses, against the
    // client's own sessions in calendar order (see lib/series.ts).
    const plans = oneToOne.clientPackage?.package
    if (plans?.isSeries && oneToOne.clientPackageId) {
      const siblings = await prisma.trainingSession.findMany({
        where: { clientPackageId: oneToOne.clientPackageId },
        orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, sessionPlanId: true },
      })
      step = resolveSeriesSteps(plans.sessionPlans, siblings).find(r => r.sessionId === sessionId)?.step ?? null
    }
  } else {
    // Group-class session the client is enrolled in — their own write-up lives
    // on their attendance row, against the session's effective form.
    const cls = await prisma.trainingSession.findFirst({
      // The enrolment IS the authorisation, so a suspended seat must not
      // authorise anything — otherwise a paused client keeps full access to
      // every class recap.
      where: { id: sessionId, classRun: { enrollments: { some: { clientId: profile.id, ...NOT_SUSPENDED } } } },
      select: {
        title: true, scheduledAt: true, sessionFormId: true, sessionIndex: true,
        classRun: {
          select: {
            name: true,
            package: {
              select: { defaultSessionFormId: true, isSeries: true, sessionPlans: PLAN_SELECT },
            },
          },
        },
        attendance: { where: { enrollment: { clientId: profile.id } }, take: 1, select: { report: true, reportSentAt: true } },
      },
    })
    if (!cls) notFound()

    sessionTitle = cls.classRun?.name ?? cls.title
    scheduledAt = cls.scheduledAt
    // A cohort moves through the curriculum together, so step N is simply
    // week N — nothing per-client is stored (see lib/series.ts).
    if (cls.classRun?.package?.isSeries) {
      step = stepForIndex(cls.classRun.package.sessionPlans, cls.sessionIndex)
    }
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
      pendingMessage = 'This session hasn’t been written up yet — check back after the class.'
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

        {/* What this session covers. Shown ABOVE the write-up and in both
            states, because it is most useful BEFORE the session — a client
            opening an upcoming class wants to know what's coming, and until now
            that page said only "check back after the class". Rendered through
            RichText, which sanitises: the copy is trainer-authored HTML, so it
            must never be dangerouslySetInnerHTML'd by hand. */}
        {step && (
          <div className="mb-4 rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-6">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Session {step.sessionIndex}
            </p>
            <h2 className="mt-0.5 font-display text-lg font-bold text-slate-900">{step.title}</h2>
            {!isRichTextEmpty(step.description) && (
              <RichText html={step.description} className="mt-2 text-sm leading-relaxed text-slate-600" />
            )}
          </div>
        )}

        {pendingMessage ? (
          <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-8 text-center">
            <h1 className="font-display text-xl font-bold text-slate-900">{sessionTitle}</h1>
            <p className="mt-1 text-sm text-slate-500">{scheduledAt.toLocaleString('en-NZ', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
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
