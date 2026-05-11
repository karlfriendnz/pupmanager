import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Calendar, Clock, MapPin, Video, ExternalLink, ChevronDown, History, Paperclip } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { formatSessionTitle } from '@/lib/utils'
import { SessionFormReport } from '@/components/session-form-report'
import { SessionLibraryTasks } from '@/components/session-library-tasks'
import { MarkCompleteButton } from '@/components/mark-complete-button'
import { MarkInvoicedButton } from '@/components/mark-invoiced-button'
import { SessionAttachments } from '@/components/session-attachments'
import { OpenSessionLink } from './open-session-link'
import { SessionMoreMenu } from './session-more-menu'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Session' }

export default async function SessionPage({
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
    where: {
      id: sessionId,
      trainerId,
      // Orphan sessions (client deleted, clientId set null) are hidden
      // everywhere else — 404 the detail page too so a stale link can't
      // surface them.
      clientId: { not: null },
    },
    include: {
      client: { select: { id: true, user: { select: { name: true, email: true } } } },
      dog: {
        select: {
          name: true,
          primaryFor: { take: 1, select: { id: true, user: { select: { name: true, email: true } } } },
        },
      },
      attachments: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, kind: true, url: true, thumbnailUrl: true,
          caption: true, sizeBytes: true, durationMs: true, createdAt: true,
        },
      },
    },
  })
  if (!trainingSession) notFound()

  const clientUser = trainingSession.client?.user ?? trainingSession.dog?.primaryFor[0]?.user
  const clientName = clientUser ? (clientUser.name ?? clientUser.email) : null
  const clientId = trainingSession.clientId ?? trainingSession.dog?.primaryFor[0]?.id
  const d = trainingSession.scheduledAt

  // Pull the last 5 past sessions for the same client so the trainer can
  // glance at prior notes without clicking away. Ordered most-recent first.
  const previousSessions = clientId
    ? await prisma.trainingSession.findMany({
        where: {
          clientId,
          id: { not: trainingSession.id },
          scheduledAt: { lte: d },
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
    : []

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <PageHeader
        title="Session"
        back={clientId ? { href: `/clients/${clientId}?tab=sessions`, label: 'Back to client' } : undefined}
        actions={
          <SessionMoreMenu
            sessionId={trainingSession.id}
            redirectTo={clientId ? `/clients/${clientId}?tab=sessions` : '/schedule'}
          />
        }
      />

      {/* Primary actions — Mark complete + Mark invoiced as big stacked
          tap targets (icon top, label below). Preview and Delete live
          inside the More menu in the sticky header above. */}
      <div className="mb-4 flex items-stretch gap-2">
        <MarkCompleteButton
          sessionId={trainingSession.id}
          initialStatus={trainingSession.status}
          variant="stacked"
        />
        <MarkInvoicedButton
          sessionId={trainingSession.id}
          initialInvoicedAt={trainingSession.invoicedAt?.toISOString() ?? null}
          variant="stacked"
        />
      </div>

      <Card className="mb-6">
        <CardBody className="py-4 flex flex-col gap-2.5 text-sm">
          {/* Identity stack — dog first (the trainer's emotional anchor),
              then the human, then the session label. In-person/virtual
              badge underneath on its own row. */}
          <div className="pb-2 border-b border-slate-100">
            {trainingSession.dog ? (
              <h2 className="text-lg font-semibold text-slate-900 leading-tight">
                🐕 {trainingSession.dog.name}
              </h2>
            ) : null}
            {clientName && (
              <p className={`${trainingSession.dog ? 'text-sm text-slate-700 mt-0.5' : 'text-lg font-semibold text-slate-900 leading-tight'}`}>
                {clientName}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-0.5">
              {formatSessionTitle(trainingSession.title)}
            </p>
            <span className={`inline-flex items-center mt-2 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full ${
              trainingSession.sessionType === 'VIRTUAL'
                ? 'bg-purple-50 text-purple-700'
                : 'bg-blue-50 text-blue-700'
            }`}>
              {trainingSession.sessionType === 'VIRTUAL' ? '💻 Virtual' : '📍 In-person'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Calendar className="h-4 w-4 text-slate-400 flex-shrink-0" />
            <span className="text-slate-700">
              {d.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Clock className="h-4 w-4 text-slate-400 flex-shrink-0" />
            <span className="text-slate-700">
              {d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })} · {trainingSession.durationMins} min
            </span>
          </div>
          {trainingSession.location && (
            <div className="flex items-center gap-3">
              <MapPin className="h-4 w-4 text-slate-400 flex-shrink-0" />
              <span className="text-slate-700">{trainingSession.location}</span>
            </div>
          )}
          {trainingSession.virtualLink && (
            <div className="flex items-center gap-3">
              <Video className="h-4 w-4 text-slate-400 flex-shrink-0" />
              <a
                href={trainingSession.virtualLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline truncate"
              >
                {trainingSession.virtualLink}
              </a>
            </div>
          )}
          {clientId && (
            <div className="pt-2 mt-1 border-t border-slate-100">
              <Link
                href={`/clients/${clientId}`}
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Client profile
              </Link>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Previous notes accordion — collapsed by default. Each past session
          is its own row; opening a row reveals the trainer's intro/closing
          messages and a summary of form answers from that session. */}
      {previousSessions.length > 0 && (
        <Card className="mb-6 overflow-hidden">
          <details className="group">
            <summary className="cursor-pointer list-none px-5 py-3 flex items-center gap-3 hover:bg-slate-50">
              <History className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-semibold text-slate-700 flex-1">
                Previous notes <span className="text-slate-400 font-normal">({previousSessions.length})</span>
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-slate-100 divide-y divide-slate-100">
              {previousSessions.map(prev => (
                <details key={prev.id} className="group/inner">
                  <summary className="cursor-pointer list-none px-5 py-3 flex items-center gap-3 hover:bg-slate-50">
                    <span className="text-xs text-slate-400 tabular-nums shrink-0 w-24">
                      {prev.scheduledAt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </span>
                    <span className="text-sm text-slate-700 flex-1 truncate">{prev.title}</span>
                    <OpenSessionLink sessionId={prev.id} />
                    <ChevronDown className="h-3.5 w-3.5 text-slate-300 transition-transform group-open/inner:rotate-180" />
                  </summary>
                  <div className="px-5 pb-4 text-sm text-slate-600 flex flex-col gap-3">
                    {prev.formResponses.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">No notes recorded for this session.</p>
                    ) : prev.formResponses.map((r, i) => {
                      const answers = (r.answers ?? {}) as Record<string, string>
                      const questions = Array.isArray(r.form.questions) ? r.form.questions as { id: string; label?: string; type?: string }[] : []
                      return (
                        <div key={i} className="flex flex-col gap-2">
                          {r.introMessage && (
                            <p className="text-sm text-slate-700 italic border-l-2 border-blue-200 pl-3">{r.introMessage}</p>
                          )}
                          {questions.map(q => {
                            const v = answers[q.id]
                            if (!v) return null
                            return (
                              <div key={q.id}>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{q.label ?? 'Answer'}</p>
                                <p className="text-sm text-slate-700 whitespace-pre-line">{String(v)}</p>
                              </div>
                            )
                          })}
                          {r.closingMessage && (
                            <p className="text-sm text-slate-700 italic border-l-2 border-emerald-200 pl-3 mt-1">{r.closingMessage}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </details>
              ))}
            </div>
          </details>
        </Card>
      )}

      {/* The form section overrides Card's padding so the questions/inputs
          stretch the full width of the card. The header line above sets the
          title; SessionFormReport itself supplies the dropdown or filler. */}
      <Card className="overflow-hidden">
        <SessionFormReport sessionId={trainingSession.id} layout="inline" autoPromptIfEmpty />
      </Card>

      {/* Trainer-uploaded media. Sits between the form and the
          library-tasks card so anything the trainer captures live in
          a session is right next to the rest of their notes. */}
      <Card className="mt-6">
        <CardBody className="py-5">
          <div className="flex items-center gap-2 mb-3">
            <Paperclip className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Attachments</h2>
          </div>
          <SessionAttachments
            sessionId={trainingSession.id}
            initialAttachments={trainingSession.attachments.map(a => ({
              id: a.id,
              kind: a.kind,
              url: a.url,
              thumbnailUrl: a.thumbnailUrl,
              caption: a.caption,
              sizeBytes: a.sizeBytes,
              durationMs: a.durationMs,
              createdAt: a.createdAt.toISOString(),
            }))}
          />
        </CardBody>
      </Card>

      <div className="mt-6">
        <SessionLibraryTasks
          sessionId={trainingSession.id}
          clientId={clientId ?? null}
          sessionDate={d.toISOString().split('T')[0]}
        />
      </div>
    </div>
  )
}
