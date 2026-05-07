import { Star, Check } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'

// Question shapes (mirrors SessionForm.questions JSON)

interface BasicQuestion {
  id: string
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5'
  label: string
  required?: boolean
  // When true: visible to the trainer only (filtered out of the client report).
  isPrivate?: boolean
}
interface CustomFieldQuestion {
  id: string
  type: 'CUSTOM_FIELD'
  customFieldId: string
  required?: boolean
  isPrivate?: boolean
}
export type ReportQuestion = BasicQuestion | CustomFieldQuestion

export interface ReportFormResponse {
  id: string
  introMessage: string | null
  closingMessage: string | null
  answers: Record<string, string>
  form: {
    id: string
    name: string
    introText: string | null
    closingText: string | null
    backgroundColor: string | null
    backgroundUrl: string | null
    questions: ReportQuestion[]
  }
}

export interface ReportTask {
  id: string
  title: string
  description: string | null
  repetitions: number | null
  videoUrl: string | null
  trainerNote: string | null
  completed?: boolean // optional — surfaced in the client view to show progress
}

export interface SessionReportProps {
  sessionTitle: string
  scheduledAt: Date | string
  clientName?: string | null
  dogName?: string | null
  formResponses: ReportFormResponse[]
  tasks: ReportTask[]
  // Map of customFieldId → label, resolved by the caller (only the caller has
  // access to the trainer's CustomField records).
  customFieldLabels?: Map<string, string>
  // Who's looking at this report. 'client' filters out private questions
  // entirely; 'trainer' shows them with a "Private" badge.
  audience?: 'trainer' | 'client'
}

export function SessionReport({
  sessionTitle,
  scheduledAt,
  clientName,
  dogName,
  formResponses,
  tasks,
  customFieldLabels = new Map(),
  audience = 'client',
}: SessionReportProps) {
  const d = new Date(scheduledAt)

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{sessionTitle}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {clientName && `${clientName} · `}
          {dogName && `🐕 ${dogName} · `}
          {d.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {formResponses.length === 0 && tasks.length === 0 && (
        <Card>
          <CardBody className="py-8 text-center text-slate-400 text-sm">
            Your trainer hasn&apos;t added a report for this session yet.
          </CardBody>
        </Card>
      )}

      {/* Opening blocks — per-response message wins, otherwise the form's intro */}
      {formResponses.map(r => {
        const intro = r.introMessage || r.form.introText || ''
        if (!intro) return null
        return (
          <Card key={`intro-${r.id}`} className="mb-6 rounded-none">
            <CardBody className="py-5">
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{intro}</p>
            </CardBody>
          </Card>
        )
      })}

      {/* Q&A blocks */}
      {formResponses.map(r => {
        // Filter private questions out for clients; trainers see all but with
        // a "Private" badge so they know it's not in the client's view.
        const visibleQuestions = audience === 'client'
          ? r.form.questions.filter(q => !q.isPrivate)
          : r.form.questions
        const answers = r.answers ?? {}
        const hasAnyAnswer = visibleQuestions.some(q => (answers[q.id] ?? '') !== '')
        if (!hasAnyAnswer) return null
        return (
          <Card key={r.id} className="mb-6 rounded-none">
            <CardBody className="py-6">
              <div className="flex flex-col gap-4">
                {visibleQuestions.map(q => {
                  const value = answers[q.id] ?? ''
                  if (!value) return null
                  const label = q.type === 'CUSTOM_FIELD'
                    ? customFieldLabels.get(q.customFieldId) ?? 'Notes'
                    : q.label
                  return (
                    <div key={q.id}>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-2">
                        <span>{label}</span>
                        {q.isPrivate && audience === 'trainer' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-semibold normal-case tracking-normal">
                            Private
                          </span>
                        )}
                      </p>
                      <ReportAnswer
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

      {/* Tasks for the client to practise */}
      {tasks.length > 0 && (
        <Card className="overflow-hidden rounded-none">
          <h2 className="font-semibold text-slate-900 px-6 py-5">Tasks for you to practise</h2>
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {tasks.map(t => (
              <div key={t.id} className="px-6 py-5">
                <div className="flex items-start gap-3">
                  {t.completed != null && (
                    <span
                      className={
                        'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ' +
                        (t.completed
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-slate-300')
                      }
                      aria-label={t.completed ? 'Completed' : 'Not yet completed'}
                    >
                      {t.completed && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p
                      className={
                        'font-medium ' +
                        (t.completed ? 'text-slate-500 line-through' : 'text-slate-900')
                      }
                    >
                      {t.title}
                    </p>
                    {t.description && <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{t.description}</p>}
                    {t.repetitions != null && t.repetitions > 0 && (
                      <p className="text-xs text-slate-400 mt-1">{t.repetitions} reps</p>
                    )}
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
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Closing — sign-off after the tasks */}
      {formResponses.map(r => {
        const closing = r.closingMessage || r.form.closingText || ''
        if (!closing) return null
        return (
          <Card key={`closing-${r.id}`} className="mt-6 rounded-none">
            <CardBody className="py-5">
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{closing}</p>
            </CardBody>
          </Card>
        )
      })}
    </>
  )
}

// Resolve the report's background image/colour from whichever attached form
// has one — picks the first hit; reports are typically single-form anyway.
export function reportBackgroundStyle(
  responses: ReportFormResponse[],
): React.CSSProperties {
  const hit = responses.find(r => r.form.backgroundColor || r.form.backgroundUrl)
  if (!hit) return {}
  if (hit.form.backgroundUrl) {
    return {
      backgroundImage: `url(${hit.form.backgroundUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }
  return { backgroundColor: hit.form.backgroundColor ?? undefined }
}

function ReportAnswer({ type, value }: { type: string; value: string }) {
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
