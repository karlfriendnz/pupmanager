import { Star, Check } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { formatSessionTitle } from '@/lib/utils'
import { ReportAttachmentsGallery, type ReportAttachment } from './report-attachments'
import { RichText } from './rich-text'
import { isRichTextEmpty } from '@/lib/rich-text'
import { SessionReportTabs, type ReportTabSpec } from './session-report-tabs'

export type { ReportAttachment }

// Question shapes (mirrors SessionForm.questions JSON)

interface BasicQuestion {
  id: string
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5' | 'DROPDOWN' | 'RADIO' | 'CHECKBOX'
  label: string
  required?: boolean
  // Option list for the choice types (dropdown / multiple choice / checkboxes).
  options?: string[]
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
  imageUrls?: string[]
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
  // Photos and videos the trainer attached to this session.
  attachments?: ReportAttachment[]
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
  attachments = [],
  customFieldLabels = new Map(),
  audience = 'client',
}: SessionReportProps) {
  const d = new Date(scheduledAt)

  // Which questions this client is allowed to see, per response. Resolved once
  // because both the Notes section and the "is there a Notes tab at all"
  // decision need the same answer, and they must not disagree.
  const answeredQuestions = formResponses.map(r => {
    const visibleQuestions = audience === 'client'
      ? r.form.questions.filter(q => !q.isPrivate)
      : r.form.questions
    const answers = r.answers ?? {}
    return { r, answers, visibleQuestions: visibleQuestions.filter(q => (answers[q.id] ?? '') !== '') }
  })
  const hasNotes = answeredQuestions.some(a =>
    a.visibleQuestions.length > 0 ||
    (a.r.introMessage || a.r.form.introText) ||
    (a.r.closingMessage || a.r.form.closingText),
  )

  // The trainer's words, all of them: the opening message, the answers, and the
  // sign-off. The sign-off used to sit after the homework; it belongs with the
  // rest of what the trainer wrote, and on a phone it has to, or the Notes tab
  // would end mid-sentence and a stray paragraph would wash up under the
  // practice list.
  const notesSection = (
    <>
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

      {/* Q&A blocks. Private questions were already filtered out for clients
          above; trainers keep them, with a "Private" badge so they know it is
          not in the client's view. */}
      {answeredQuestions.map(({ r, answers, visibleQuestions }) => {
        if (visibleQuestions.length === 0) return null
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
                      <p className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
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

      {/* Closing — the trainer's sign-off, at the end of the trainer's words. */}
      {formResponses.map(r => {
        const closing = r.closingMessage || r.form.closingText || ''
        if (!closing) return null
        return (
          <Card key={`closing-${r.id}`} className="mb-6 rounded-none">
            <CardBody className="py-5">
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{closing}</p>
            </CardBody>
          </Card>
        )
      })}
    </>
  )

  // Photos & videos from this session. They sit AFTER the write-up and BEFORE
  // the homework because that is the order Karl asked for — questions, then
  // media, then homework — and it is the order the report reads in: the trainer
  // says what happened, the photos show it, and the practice that follows from
  // it comes last. Above the questions they were a gallery with no caption,
  // arriving before anyone had said what the session was.
  const mediaSection = (
    <>
      {attachments.length > 0 && (
        <Card className="mb-6 rounded-none">
          <div className="px-6 py-5">
            <ReportAttachmentsGallery attachments={attachments} />
          </div>
        </Card>
      )}
    </>
  )

  // Tasks for the client to practise.
  const homeworkSection = (
    <>
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
                    {/* Tiptap HTML — it goes through <RichText>, which
                        sanitizes and applies .tiptap-body. Rendered as text it
                        printed its own <p> tags to the client (AGENTS.md:
                        never render a description any other way). */}
                    {t.description && !isRichTextEmpty(t.description) && (
                      <div className="mt-1 text-sm text-slate-600"><RichText html={t.description} /></div>
                    )}
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
                    {t.imageUrls && t.imageUrls.length > 0 && (
                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {t.imageUrls.map((src, i) => (
                          <a
                            key={i}
                            href={src}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block aspect-square rounded-lg overflow-hidden bg-slate-100"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt={`${t.title} reference ${i + 1}`} className="h-full w-full object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )

  // Only sections with something in them become tabs. A tab bar offering
  // "Photos" on a session with no photos is a button that shows an empty page.
  const tabs: ReportTabSpec[] = [
    ...(hasNotes ? [{ id: 'notes', label: 'Notes', node: notesSection }] : []),
    ...(attachments.length > 0 ? [{ id: 'media', label: 'Photos', node: mediaSection }] : []),
    ...(tasks.length > 0 ? [{ id: 'homework', label: 'Homework', node: homeworkSection }] : []),
  ]

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{formatSessionTitle(sessionTitle)}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {clientName && `${clientName} · `}
          {dogName && `🐕 ${dogName} · `}
          {d.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {tabs.length === 0 && (
        <Card>
          <CardBody className="py-8 text-center text-slate-400 text-sm">
            There&apos;s no report for this session yet.
          </CardBody>
        </Card>
      )}

      <SessionReportTabs tabs={tabs} />
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
  if (type === 'CHECKBOX') {
    let items: string[] = []
    try {
      const arr = JSON.parse(value)
      items = Array.isArray(arr) ? arr.map(String) : [value]
    } catch {
      items = value ? [value] : []
    }
    if (items.length === 0) return null
    return (
      <ul className="flex flex-col gap-1.5">
        {items.map(item => (
          <li key={item} className="flex items-center gap-2 text-[15px] text-slate-700">
            <Check className="h-4 w-4 flex-shrink-0 text-emerald-600" />
            {item}
          </li>
        ))}
      </ul>
    )
  }
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
  return <p className="text-[15px] text-slate-700 whitespace-pre-wrap leading-relaxed">{value}</p>
}
