import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { ArrowLeft, Eye, Star } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Session report preview' }

interface BasicQuestion {
  id: string
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5'
  label: string
  required?: boolean
}
interface CustomFieldQuestion {
  id: string
  type: 'CUSTOM_FIELD'
  customFieldId: string
  required?: boolean
}
type Question = BasicQuestion | CustomFieldQuestion

export default async function SessionPreviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/onboarding')

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
          form: { select: { id: true, name: true, introText: true, closingText: true, questions: true } },
        },
      },
    },
  })
  if (!trainingSession) notFound()

  // Resolve labels for any CUSTOM_FIELD questions across all attached forms.
  const linkedIds = trainingSession.formResponses.flatMap(r => {
    const qs = Array.isArray(r.form.questions) ? r.form.questions as unknown as Question[] : []
    return qs.filter(q => q.type === 'CUSTOM_FIELD').map(q => (q as CustomFieldQuestion).customFieldId)
  })
  const linkedFields = linkedIds.length > 0
    ? await prisma.customField.findMany({
        where: { trainerId, id: { in: linkedIds } },
        select: { id: true, label: true, type: true },
      })
    : []
  const linkedLabel = new Map(linkedFields.map(f => [f.id, f.label]))

  const clientName = trainingSession.client?.user.name ?? null
  const d = trainingSession.scheduledAt

  return (
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

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{trainingSession.title}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {clientName && `${clientName} · `}
          {trainingSession.dog && `🐕 ${trainingSession.dog.name} · `}
          {d.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {trainingSession.formResponses.length === 0 && trainingSession.tasks.length === 0 && (
        <Card>
          <CardBody className="py-8 text-center text-slate-400 text-sm">
            Nothing to preview yet — fill in a form or add some tasks.
          </CardBody>
        </Card>
      )}

      {/* Opening: per-session message wins, otherwise the form template's
          introText. We render it as a standalone block before the Q&A. */}
      {trainingSession.formResponses.map(r => {
        const intro = r.introMessage || r.form.introText || ''
        if (!intro) return null
        return (
          <Card key={`intro-${r.id}`} className="mb-6">
            <CardBody className="py-5">
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{intro}</p>
            </CardBody>
          </Card>
        )
      })}

      {trainingSession.formResponses.map(r => {
        const questions: Question[] = Array.isArray(r.form.questions)
          ? r.form.questions as unknown as Question[]
          : []
        const answers = (r.answers ?? {}) as Record<string, string>
        const hasAnyAnswer = questions.some(q => (answers[q.id] ?? '') !== '')
        if (!hasAnyAnswer) return null
        return (
          <Card key={r.id} className="mb-6">
            <CardBody className="py-6">
              <div className="flex flex-col gap-4">
                {questions.map(q => {
                  const value = answers[q.id] ?? ''
                  if (!value) return null
                  const label = q.type === 'CUSTOM_FIELD'
                    ? linkedLabel.get(q.customFieldId) ?? 'Notes'
                    : q.label
                  return (
                    <div key={q.id}>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
                        {label}
                      </p>
                      <PreviewAnswer
                        type={q.type === 'CUSTOM_FIELD' ? 'SHORT_TEXT' : q.type}
                        value={value}
                      />
                    </div>
                  )
                })}
              </div>
            </CardBody>
          </Card>
        )
      })}

      {trainingSession.tasks.length > 0 && (
        <Card className="overflow-hidden">
          <h2 className="font-semibold text-slate-900 px-6 py-5">Tasks for you to practise</h2>
          {/* No outer padding on the rows — each task spans the card edge to
              edge, separated by a divider line. */}
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {trainingSession.tasks.map(t => (
              <div key={t.id} className="px-6 py-5">
                <p className="font-medium text-slate-900">{t.title}</p>
                {t.description && <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{t.description}</p>}
                {t.repetitions && <p className="text-xs text-slate-400 mt-1">{t.repetitions} reps</p>}
                {t.trainerNote && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Trainer note</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{t.trainerNote}</p>
                  </div>
                )}
                {t.videoUrl && (
                  <a
                    href={t.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-3 text-sm text-blue-600 hover:underline"
                  >
                    Watch demo →
                  </a>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Closing: per-session message wins, otherwise the form's closingText.
          Renders AFTER tasks so it reads as the trainer's sign-off. */}
      {trainingSession.formResponses.map(r => {
        const closing = r.closingMessage || r.form.closingText || ''
        if (!closing) return null
        return (
          <Card key={`closing-${r.id}`} className="mt-6">
            <CardBody className="py-5">
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{closing}</p>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}

function PreviewAnswer({ type, value }: { type: string; value: string }) {
  if (type === 'RATING_1_5') {
    const n = Math.max(0, Math.min(5, parseInt(value, 10) || 0))
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map(i => (
          <Star
            key={i}
            className={`h-4 w-4 ${i <= n ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`}
          />
        ))}
      </div>
    )
  }
  return <p className="text-sm text-slate-700 whitespace-pre-wrap">{value}</p>
}
