import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Calendar, ChevronDown, MapPin, Video, User, Clock, History, Paperclip, PawPrint, Eye, ListChecks } from 'lucide-react'
import { formatSessionTitle } from '@/lib/utils'
import { formatMoney } from '@/lib/money'
import { SessionFormReport } from '@/components/session-form-report'
import { hasAddon } from '@/lib/billing'
import { SessionLibraryTasks } from '@/components/session-library-tasks'
import { PaySessionButton } from './pay-session-button'
import { SessionAttachments } from '@/components/session-attachments'
import { SessionTimeTracking } from '@/components/session-time-tracking'
import { OpenSessionLink } from './open-session-link'
import { CompleteCell, InvoicedCell, DeleteSessionRow } from './session-actions'
import { DisclosureRow, FactRow, LinkRow } from './session-rows'
import { FlatBlock } from '@/components/shared/flat-list'
import { PageHeader } from '@/components/shared/page-header'
import { SampleRecordBadge } from '@/components/sample-record-badge'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Session notes' }

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

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

  // What's owed for this session, and how to collect it. Two shapes:
  //
  // SETTLE — there's already an UNPAID invoice, because the booking went
  // through the app and createInvoiceForAssignment raised one. That receivable
  // lives on the PACKAGE, not the session: one invoice covers all N sessions
  // (Invoice has no session link, only a shared clientPackageId). So we edit
  // that invoice rather than raise a second one for money already owed, and
  // taking payment from any one session settles the lot.
  //
  // FRESH — no invoice exists. Very common: a package created outside the
  // assign route (seeded, imported, back-filled) never raised one. Without a
  // fallback the button would simply never appear for those — on this dev data
  // that was 1 session out of 233. So we open a normal sale instead, seeded
  // with what this session is worth.
  //
  // Neither is the session's `invoicedAt` flag (the manual "I billed this
  // elsewhere" marker), which has no amount and no link to any Invoice.
  const unpaidInvoice = trainingSession.clientPackageId
    ? await prisma.invoice.findFirst({
        where: {
          trainerId,
          clientId: trainingSession.clientId!,
          sourceType: 'PACKAGE',
          sourceId: trainingSession.clientPackageId,
          // Only an UNPAID invoice is editable — PATCH 409s once anything's paid.
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

  // For the FRESH case, price this one session. Mirrors the dashboard's
  // "sessions to invoice" maths exactly (package price ÷ session count) so the
  // two surfaces can't quote different numbers for the same session.
  const pkg = trainingSession.clientPackageId && !unpaidInvoice
    ? await prisma.clientPackage.findFirst({
        where: { id: trainingSession.clientPackageId },
        select: { package: { select: { name: true, priceCents: true, specialPriceCents: true, sessionCount: true } } },
      })
    : null

  const perSessionCents = (() => {
    const p = pkg?.package
    if (!p) return 0
    const price = p.specialPriceCents ?? p.priceCents
    if (!price || !p.sessionCount || p.sessionCount <= 0) return 0
    return Math.round(price / p.sessionCount)
  })()

  // Taking payment is the instant-sale add-on's surface, so gate it the same way
  // the composer's other entry points are. The APIs re-check regardless.
  const posOn = await hasAddon(trainerId, 'pos')
  const canTakePayment = posOn && trainingSession.client != null

  // The trainer's brand colour + payout currency in one read. The accent tints
  // ONLY the row icons, via color-mix toward slate-900 (AGENTS.md) — a pastel
  // brand stays legible and nothing else on the page is painted.
  const profile = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { payoutCurrency: true, emailAccentColor: true },
  })
  const accent = profile?.emailAccentColor && HEX.test(profile.emailAccentColor)
    ? profile.emailAccentColor
    : null

  // An existing invoice already carries the currency it was raised in; a fresh
  // sale uses the trainer's payout currency.
  const currency = unpaidInvoice?.currency ?? profile?.payoutCurrency ?? 'nzd'

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

  // Where this session sits in its lifecycle. A word and a dot in the identity
  // row — not a tinted pill, and never repeated further down the page.
  const STATUS_META: Record<string, { label: string; dot: string }> = {
    UPCOMING:  { label: 'Upcoming',  dot: 'bg-slate-300' },
    COMPLETED: { label: 'Completed', dot: 'bg-slate-500' },
    COMMENTED: { label: 'Commented', dot: 'bg-amber-500' },
    INVOICED:  { label: 'Invoiced',  dot: 'bg-emerald-500' },
  }
  const status = STATUS_META[trainingSession.status] ?? STATUS_META.UPCOMING

  // Homework already attached — a count for the row, so an empty section costs
  // one line instead of two full-width buttons.
  const taskCount = await prisma.trainingTask.count({ where: { sessionId: trainingSession.id } })

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

  // Sublines for the collapsed sections. Each says what's inside, so the
  // trainer never has to open a section to find out it's empty.
  const totalMinutes = timeEntries.reduce((s, e) => s + e.minutes, 0)
  const billableCents = timeEntries.reduce((s, e) => s + (e.amountCents ?? 0), 0)
  const timeSub = timeEntries.length === 0
    ? 'Nothing logged'
    : [
        `${Number((totalMinutes / 60).toFixed(2))} h`,
        billableCents > 0 ? `${formatMoney(billableCents, currency)} billable` : null,
      ].filter(Boolean).join(' · ')

  const photoCount = trainingSession.attachments.filter(a => a.kind === 'IMAGE').length
  const videoCount = trainingSession.attachments.length - photoCount
  const attachmentSub = trainingSession.attachments.length === 0
    ? 'No photos or videos'
    : [
        photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? '' : 's'}` : null,
        videoCount > 0 ? `${videoCount} video${videoCount === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · ')

  return (
    <>
      <PageHeader
        title="Session notes"
        back={clientId ? { href: `/clients/${clientId}?tab=sessions`, label: 'Back to client' } : undefined}
      />
      <div className="p-4 md:p-8 w-full max-w-3xl lg:max-w-5xl mx-auto">

      {trainingSession.client?.isSample && (
        <div className="mb-4">
          <SampleRecordBadge />
        </div>
      )}

      {/* One column on a phone. From lg the container splits: the session's
          facts + actions become a sticky rail beside the write-up. Same blocks
          in both — only the CONTAINER reflows (AGENTS.md). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start lg:gap-6">

        {/* WHO / WHEN / WHERE / WHAT NOW — one bordered block, hairline rows. */}
        <aside className="lg:sticky lg:top-4">
          <FlatBlock>
            {/* Identity: avatar, name, one subline, status. Was a 340px tinted
                hero with a photo, a heading, a pill and two more lines. */}
            <div className="flex items-center gap-3 px-4 py-3">
              {trainingSession.dog?.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={trainingSession.dog.photoUrl}
                  alt={trainingSession.dog.name}
                  className="h-11 w-11 flex-shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-slate-100">
                  <PawPrint className="h-5 w-5 text-slate-500" strokeWidth={1.75} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-slate-900">
                  {trainingSession.dog?.name ?? clientName ?? 'Session'}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                  {[clientName, formatSessionTitle(trainingSession.title)].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="flex flex-shrink-0 items-center gap-1.5 text-[13px] text-slate-500">
                <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                {status.label}
              </span>
            </div>

            <FactRow
              icon={Calendar}
              accent={accent}
              label={d.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              sub={`${d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })} · ${trainingSession.durationMins} min`}
            />

            {trainingSession.sessionType === 'VIRTUAL' ? (
              trainingSession.virtualLink ? (
                <LinkRow
                  icon={Video}
                  accent={accent}
                  label="Virtual session"
                  href={trainingSession.virtualLink}
                  external
                  trailingLabel="Join"
                />
              ) : (
                <FactRow icon={Video} accent={accent} label="Virtual session" />
              )
            ) : (
              <FactRow icon={MapPin} accent={accent} label={trainingSession.location || 'In-person'} />
            )}

            {/* The three things a trainer does at the end of a session, as one
                divided strip instead of three 130px tiles in three colours. */}
            <div className={`grid ${canTakePayment ? 'grid-cols-3' : 'grid-cols-2'} divide-x divide-slate-200`}>
              <CompleteCell
                sessionId={trainingSession.id}
                initialStatus={trainingSession.status}
                accent={accent}
              />
              <InvoicedCell
                sessionId={trainingSession.id}
                initialInvoicedAt={trainingSession.invoicedAt?.toISOString() ?? null}
                accent={accent}
              />
              {canTakePayment && (
                <PaySessionButton
                  accent={accent}
                  currency={currency}
                  prefill={{
                    client: {
                      id: trainingSession.client!.id,
                      name: trainingSession.client!.user?.name ?? null,
                      dogName: trainingSession.dog?.name ?? null,
                      dogPhotoUrl: trainingSession.dog?.photoUrl ?? null,
                    },
                    lines: unpaidInvoice
                      // Settling: seed with what they already owe. PATCH is
                      // replace-all, so these must go back with any upsell or
                      // they'd be wiped.
                      ? unpaidInvoice.lines.map((l) => ({
                          description: l.description,
                          quantity: l.quantity,
                          unitAmountCents: l.unitAmountCents,
                          xeroAccountCode: l.xeroAccountCode,
                        }))
                      // Fresh: seed this session at its share of the package
                      // price. Skipped when unpriced — the trainer just picks
                      // items instead of starting from a $0 line.
                      : perSessionCents > 0
                        ? [{
                            description: formatSessionTitle(trainingSession.title),
                            quantity: 1,
                            unitAmountCents: perSessionCents,
                          }]
                        : [],
                    ...(unpaidInvoice
                      ? { settle: { invoiceId: unpaidInvoice.id, payToken: unpaidInvoice.payToken } }
                      : {}),
                  }}
                />
              )}
            </div>
          </FlatBlock>
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          {/* The write-up itself — the one thing on this page that earns a
              block of its own. */}
          {notesOn && (
            <FlatBlock>
              <SessionFormReport sessionId={trainingSession.id} layout="inline" autoPromptIfEmpty />
            </FlatBlock>
          )}

          {/* Everything else, as rows that open. A section with nothing in it
              costs one line; a section with content opens on arrival. */}
          <FlatBlock>
            <DisclosureRow
              icon={Paperclip}
              accent={accent}
              label="Photos & video"
              sub={attachmentSub}
              defaultOpen={trainingSession.attachments.length > 0}
            >
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
            </DisclosureRow>

            <DisclosureRow
              icon={ListChecks}
              accent={accent}
              label="Homework"
              sub={taskCount === 0 ? 'None set' : `${taskCount} task${taskCount === 1 ? '' : 's'}`}
              defaultOpen={taskCount > 0}
            >
              <SessionLibraryTasks
                sessionId={trainingSession.id}
                clientId={clientId ?? null}
                sessionDate={d.toISOString().split('T')[0]}
              />
            </DisclosureRow>

            <DisclosureRow
              icon={Clock}
              accent={accent}
              label="Time tracking"
              sub={timeSub}
              defaultOpen={timeEntries.length > 0}
            >
              <SessionTimeTracking
                sessionId={trainingSession.id}
                initialEntries={timeEntries}
                members={timeMembers}
              />
            </DisclosureRow>

            {previousSessions.length > 0 && (
              <DisclosureRow
                icon={History}
                accent={accent}
                label="Previous notes"
                sub={`${previousSessions.length} earlier session${previousSessions.length === 1 ? '' : 's'}`}
              >
                <div className="-mx-4 -my-4 divide-y divide-slate-200">
                  {previousSessions.map(prev => (
                    <details key={prev.id} className="group/inner">
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 active:bg-slate-50">
                        <span className="w-20 flex-shrink-0 text-[13px] tabular-nums text-slate-400">
                          {prev.scheduledAt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' })}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{prev.title}</span>
                        <OpenSessionLink sessionId={prev.id} />
                        <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400 transition-transform group-open/inner:rotate-180" />
                      </summary>
                      <div className="flex flex-col gap-3 px-4 pb-4 text-sm text-slate-600">
                        {prev.formResponses.length === 0 ? (
                          <p className="text-[13px] text-slate-400">No notes recorded for this session.</p>
                        ) : prev.formResponses.map((r, i) => {
                          const answers = (r.answers ?? {}) as Record<string, string>
                          const questions = Array.isArray(r.form.questions) ? r.form.questions as { id: string; label?: string; type?: string }[] : []
                          return (
                            <div key={i} className="flex flex-col gap-2">
                              {r.introMessage && (
                                <p className="border-l-2 border-slate-200 pl-3 text-sm italic text-slate-700">{r.introMessage}</p>
                              )}
                              {questions.map(q => {
                                const v = answers[q.id]
                                if (!v) return null
                                return (
                                  <div key={q.id}>
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{q.label ?? 'Answer'}</p>
                                    <p className="whitespace-pre-line text-sm text-slate-700">{String(v)}</p>
                                  </div>
                                )
                              })}
                              {r.closingMessage && (
                                <p className="mt-1 border-l-2 border-slate-200 pl-3 text-sm italic text-slate-700">{r.closingMessage}</p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </details>
                  ))}
                </div>
              </DisclosureRow>
            )}

            {/* Was hidden behind a "…" menu in the header: a whole portal,
                overlay and outside-click handler to conceal two links. */}
            <LinkRow
              icon={Eye}
              accent={accent}
              label="Preview report"
              sub="See what the client will read"
              href={`/sessions/${trainingSession.id}/preview`}
            />

            {clientId && (
              <LinkRow
                icon={User}
                accent={accent}
                label="Client profile"
                sub={clientName ?? undefined}
                href={`/clients/${clientId}`}
              />
            )}
          </FlatBlock>

          {/* Destructive, so it sits on its own at the very bottom — quiet red
              text, and it asks before it does anything. */}
          <FlatBlock>
            <DeleteSessionRow
              sessionId={trainingSession.id}
              redirectTo={clientId ? `/clients/${clientId}?tab=sessions` : '/schedule'}
            />
          </FlatBlock>
        </div>
      </div>
      </div>
    </>
  )
}
