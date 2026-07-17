import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Calendar, Clock, MapPin, Video, ExternalLink, ChevronDown, History, Paperclip, PawPrint } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { formatSessionTitle } from '@/lib/utils'
import { SessionFormReport } from '@/components/session-form-report'
import { hasAddon } from '@/lib/billing'
import { SessionLibraryTasks } from '@/components/session-library-tasks'
import { MarkCompleteButton } from '@/components/mark-complete-button'
import { MarkInvoicedButton } from '@/components/mark-invoiced-button'
import { PaySessionButton } from './pay-session-button'
import { SessionAttachments } from '@/components/session-attachments'
import { SessionTimeTracking } from '@/components/session-time-tracking'
import { OpenSessionLink } from './open-session-link'
import { SessionMoreMenu } from './session-more-menu'
import { PageHeader } from '@/components/shared/page-header'
import { SampleRecordBadge } from '@/components/sample-record-badge'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Session notes' }

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  // Session notes are gated by the Notes add-on (default-on). When off, the
  // write-up editor is hidden and the page just shows the session details.
  const notesOn = await hasAddon(trainerId, 'notes')

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
      client: { select: { id: true, isSample: true, user: { select: { name: true, email: true } } } },
      dog: {
        select: {
          name: true,
          photoUrl: true,
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
      timeEntries: {
        orderBy: { createdAt: 'asc' },
        include: { membership: { select: { user: { select: { name: true, email: true } } } } },
      },
    },
  })
  if (!trainingSession) notFound()

  // What's actually owed for this session, if anything.
  //
  // The receivable lives on the PACKAGE, not the session: a pay-later booking
  // raises one Invoice per assignment (sourceType 'PACKAGE', sourceId =
  // ClientPackage.id) covering all its sessions, and Invoice has no session
  // link at all. So we resolve session → clientPackageId → its invoice, and
  // "take payment" here settles the whole package — you can't part-pay it.
  //
  // Note this is NOT the same as the session's `invoicedAt` flag (the red/green
  // $ disc), which is a manual "I billed this elsewhere" marker carrying no
  // amount and nothing linking it to a real Invoice. Only an UNPAID invoice can
  // be edited (the PATCH 409s once anything is paid), so anything else means no
  // button.
  const payable = trainingSession.clientPackageId
    ? await prisma.invoice.findFirst({
        where: {
          trainerId,
          clientId: trainingSession.clientId!,
          sourceType: 'PACKAGE',
          sourceId: trainingSession.clientPackageId,
          status: 'UNPAID',
        },
        select: {
          id: true,
          payToken: true,
          currency: true,
          lines: {
            orderBy: { sortOrder: 'asc' },
            select: { description: true, quantity: true, unitAmountCents: true, xeroAccountCode: true },
          },
        },
      })
    : null

  // Taking payment is the instant-sale add-on's surface, so gate it the same way
  // the composer's other entry points are. The APIs re-check regardless.
  const canTakePayment = payable != null && (await hasAddon(trainerId, 'pos'))

  // Team members for the "who logged time" picker, plus the session's logged
  // time entries shaped for the client component.
  const members = await prisma.trainerMembership.findMany({
    where: { companyId: trainerId },
    orderBy: { acceptedAt: 'asc' },
    select: { id: true, user: { select: { name: true, email: true } } },
  })
  const timeMembers = members.map(m => ({ id: m.id, name: m.user.name ?? m.user.email }))
  const timeEntries = trainingSession.timeEntries.map(e => ({
    id: e.id,
    membershipId: e.membershipId,
    memberName: e.membership.user.name ?? e.membership.user.email,
    minutes: e.minutes,
    rateCents: e.rateCents,
    amountCents: e.rateCents == null ? null : Math.round((e.minutes / 60) * e.rateCents),
    note: e.note,
    createdAt: e.createdAt.toISOString(),
  }))

  const clientUser = trainingSession.client?.user ?? trainingSession.dog?.primaryFor[0]?.user
  const clientName = clientUser ? (clientUser.name ?? clientUser.email) : null
  const clientId = trainingSession.clientId ?? trainingSession.dog?.primaryFor[0]?.id
  const d = trainingSession.scheduledAt

  // Where this session sits in its lifecycle — surfaced as a coloured chip in
  // the identity rail so the trainer can see status at a glance.
  const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
    UPCOMING:  { label: 'Upcoming',  cls: 'bg-slate-100 text-slate-600',          dot: 'bg-slate-400' },
    COMPLETED: { label: 'Completed', cls: 'bg-accent-soft text-accent-strong',    dot: 'bg-accent' },
    COMMENTED: { label: 'Commented', cls: 'bg-amber-50 text-amber-700',           dot: 'bg-amber-500' },
    INVOICED:  { label: 'Invoiced',  cls: 'bg-emerald-50 text-emerald-700',       dot: 'bg-emerald-500' },
  }
  const status = STATUS_META[trainingSession.status] ?? STATUS_META.UPCOMING

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
    <>
      <PageHeader
        title="Session notes"
        back={clientId ? { href: `/clients/${clientId}?tab=sessions`, label: 'Back to client' } : undefined}
        actions={
          <SessionMoreMenu
            sessionId={trainingSession.id}
            redirectTo={clientId ? `/clients/${clientId}?tab=sessions` : '/schedule'}
          />
        }
      />
      <div className="p-4 md:p-8 w-full max-w-3xl lg:max-w-6xl xl:max-w-7xl mx-auto">

      {trainingSession.client?.isSample && (
        <div className="mb-4">
          <SampleRecordBadge />
        </div>
      )}

      {/* Desktop (lg+): two-column layout — left rail with the session's
          metadata + primary actions, right column with the form report,
          attachments, and library tasks. The rail is sticky so trainers
          can scroll through long form responses without losing context.
          Mobile/tablet keep the original single-column flow. */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:gap-8 xl:items-start">
        <aside className="flex flex-col gap-4 xl:sticky xl:top-4">
          {/* Identity rail — a dog-forward hero (photo + name + lifecycle
              status), then the session's key facts and the primary actions.
              Sticky so it stays in view while the trainer scrolls long notes. */}
          <Card className="overflow-hidden">
            <div className="bg-accent-tint px-5 pt-6 pb-5 flex flex-col items-center text-center">
              {trainingSession.dog?.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={trainingSession.dog.photoUrl}
                  alt={trainingSession.dog.name}
                  className="h-20 w-20 rounded-2xl object-cover ring-4 ring-white shadow-sm"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-accent-soft text-accent-strong ring-4 ring-white shadow-sm">
                  <PawPrint className="h-8 w-8" />
                </div>
              )}
              <h2 className="mt-3 text-xl font-bold text-slate-900 leading-tight">
                {trainingSession.dog?.name ?? clientName ?? 'Session'}
              </h2>
              <span className={`inline-flex items-center gap-1.5 mt-2 text-[11px] font-semibold px-2.5 py-1 rounded-full ${status.cls}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                {status.label}
              </span>
              {trainingSession.dog && clientName && (
                <p className="mt-2 text-sm font-medium text-slate-700">{clientName}</p>
              )}
              <p className="mt-0.5 text-xs text-slate-500">{formatSessionTitle(trainingSession.title)}</p>
            </div>

            <CardBody className="py-4 flex flex-col gap-3 text-sm">
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-accent flex-shrink-0" />
                <span className="text-slate-700">
                  {d.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-accent flex-shrink-0" />
                <span className="text-slate-700">
                  {d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })} · {trainingSession.durationMins} min
                </span>
              </div>
              {trainingSession.sessionType === 'VIRTUAL' ? (
                <div className="flex items-center gap-3">
                  <Video className="h-4 w-4 text-accent flex-shrink-0" />
                  {trainingSession.virtualLink ? (
                    <a href={trainingSession.virtualLink} target="_blank" rel="noopener noreferrer" className="text-accent-strong hover:underline truncate">
                      Virtual session
                    </a>
                  ) : (
                    <span className="text-slate-700">Virtual session</span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 text-accent flex-shrink-0" />
                  <span className="text-slate-700">{trainingSession.location || 'In-person'}</span>
                </div>
              )}

              {/* Primary actions — complete + invoice as big tap targets. */}
              <div className="flex items-stretch gap-2 pt-1">
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
                {/* Only when there's a real UNPAID invoice behind this session —
                    otherwise there's nothing to take payment for. */}
                {canTakePayment && payable && (
                  <PaySessionButton
                    currency={payable.currency}
                    prefill={{
                      client: {
                        id: trainingSession.client!.id,
                        name: trainingSession.client!.user?.name ?? null,
                        dogName: trainingSession.dog?.name ?? null,
                        dogPhotoUrl: trainingSession.dog?.photoUrl ?? null,
                      },
                      // Seed with what they already owe. PATCH is replace-all,
                      // so these must go back with the upsell or they'd be wiped.
                      lines: payable.lines.map((l) => ({
                        description: l.description,
                        quantity: l.quantity,
                        unitAmountCents: l.unitAmountCents,
                        xeroAccountCode: l.xeroAccountCode,
                      })),
                      settle: { invoiceId: payable.id, payToken: payable.payToken },
                    }}
                  />
                )}
              </div>

              {clientId && (
                <Link
                  href={`/clients/${clientId}`}
                  className="inline-flex items-center gap-1.5 text-sm text-accent-strong hover:underline font-medium pt-0.5"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Client profile
                </Link>
              )}
            </CardBody>
          </Card>

          {/* Per-member billable time logged against this session. Lives in the
              rail alongside the session's facts and actions. */}
          <Card>
            <CardBody className="py-5">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold text-slate-700">Time tracking</h2>
              </div>
              <SessionTimeTracking
                sessionId={trainingSession.id}
                initialEntries={timeEntries}
                members={timeMembers}
              />
            </CardBody>
          </Card>

          {/* Previous notes accordion — collapsed by default. Each past session
              is its own row; opening a row reveals the trainer's intro/closing
              messages and a summary of form answers from that session. */}
          {previousSessions.length > 0 && (
            <Card className="overflow-hidden">
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
                            <p className="text-sm text-slate-700 italic border-l-2 border-accent/40 pl-3">{r.introMessage}</p>
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
        </aside>

        <div className="flex flex-col gap-6 mt-6 xl:mt-0 min-w-0">
          {/* The form section overrides Card's padding so the questions/inputs
              stretch the full width of the card. The header line above sets the
              title; SessionFormReport itself supplies the dropdown or filler. */}
          {notesOn && (
            <Card className="overflow-hidden">
              <SessionFormReport sessionId={trainingSession.id} layout="inline" autoPromptIfEmpty />
            </Card>
          )}

          {/* Trainer-uploaded media. Sits between the form and the
              library-tasks card so anything the trainer captures live in
              a session is right next to the rest of their notes. */}
          <Card>
            <CardBody className="py-5">
              <div className="flex items-center gap-2 mb-3">
                <Paperclip className="h-4 w-4 text-accent" />
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

          <SessionLibraryTasks
            sessionId={trainingSession.id}
            clientId={clientId ?? null}
            sessionDate={d.toISOString().split('T')[0]}
          />
        </div>
      </div>
      </div>
    </>
  )
}
