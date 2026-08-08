import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Calendar, ChevronDown, Video, User, Clock, History, Paperclip, PawPrint, Eye, ListChecks } from 'lucide-react'
import { formatSessionTitle } from '@/lib/utils'
import { formatMoney } from '@/lib/money'
import { runSessionHref } from '@/lib/run-kind'
import { SessionFormReport } from '@/components/session-form-report'
import { hasAddon } from '@/lib/billing'
import { SessionLibraryTasks } from '@/components/session-library-tasks'
import { SessionSeriesStep } from '@/components/trainer/session-series-step'
import { OpenSessionLink } from '../open-session-link'
import { DeleteSessionRow } from '../session-actions'
import { DisclosureRow, FactRow, LinkRow } from '../session-rows'
import { FlatBlock } from '@/components/shared/flat-list'
import { PageHeader } from '@/components/shared/page-header'
import { SetPageImmersive } from '@/components/shared/page-title'
import { SampleRecordBadge } from '@/components/sample-record-badge'
import { SessionScreenTabs } from '../session-screen-tabs'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Session notes' }

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>
  searchParams: Promise<{ from?: string; tab?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  // Session notes are gated by the Notes add-on (default-on). When off, the
  // write-up editor is hidden and the page just shows the session details.
  const notesOn = await hasAddon(trainerId, 'notes')

  const { sessionId } = await params

  // Where Back goes. The calendar sends `?from=/schedule?date=…` when it opens
  // a session on a phone, so Back returns to the week you were looking at
  // rather than to the client's list — which is where you'd have gone if you'd
  // arrived from the client (Karl: "unless you can make the back button go
  // back to the schedule view").
  //
  // Only an in-app path is honoured: `from` arrives in the URL, so anything
  // else is an open redirect wearing a Back button, and `//host` is a
  // protocol-relative URL that leaves the site while looking like a path.
  const sp = await searchParams
  const rawFrom = sp.from
  const cameFrom = rawFrom && rawFrom.startsWith('/') && !rawFrom.startsWith('//') ? rawFrom : null

  // Tenant scope only. Do NOT also filter on `clientId: { not: null }` — a
  // GROUP-CLASS session has clientId null BY DESIGN (schema: attendance is
  // per-enrollee via SessionAttendance), so that filter 404'd every class
  // session in the app. On this dev data that was 588 of 898 sessions. The two
  // null-client cases are told apart below by `classRunId`.
  const trainingSession = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId },
    include: {
      // The run's backing package decides WHICH section's screen this session
      // belongs to — see the redirect below.
      classRun: {
        select: {
          package: {
            select: {
              isGroup: true, allowDropIn: true, sessionCount: true,
              recurrenceRule: true, isPuppySchool: true, isEvent: true,
            },
          },
        },
      },
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
  // No such session for this trainer — a genuine 404, and the tenant guard.
  if (!trainingSession) notFound()

  // A session on a RUN belongs to a cohort, not to one client, and already has
  // a screen built for it (attendance per enrollee). Anything landing here — a
  // bookmark, a notification, an old link — gets sent there rather than a wall.
  //
  // WHICH screen depends on the kind of run: a ClassRun backs group classes,
  // casual/drop-in classes, one-off events AND doggy daycare, and each has its
  // own section. This used to send all four to /classes/…, so a casual run
  // landed on the group-class screen with "Back to class" pointing out of the
  // section the trainer came from, and an event — which has no per-session
  // screen at all — landed on a URL for a session page it doesn't own.
  if (trainingSession.classRunId && trainingSession.classRun) {
    redirect(runSessionHref(
      trainingSession.classRunId,
      trainingSession.id,
      trainingSession.classRun.package,
    ))
  }

  // Neither a client nor a class: the client was deleted and the session was
  // left behind. There's nothing to show, but a bare 404 for a row a trainer
  // just tapped reads as a bug. Say what happened instead.
  if (!trainingSession.clientId && !trainingSession.dog) {
    return (
      <>
        <PageHeader title="Session notes" back={{ href: '/schedule', label: 'Back to schedule' }} />
        <div className="p-4 md:p-8 w-full max-w-3xl mx-auto">
          <FlatBlock>
            <div className="px-4 py-4">
              <p className="text-sm font-medium text-slate-900">This session has no client</p>
              <p className="mt-1 text-[13px] text-slate-500">
                {formatSessionTitle(trainingSession.title)} on{' '}
                {trainingSession.scheduledAt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}.
                Its client was removed, so there are no notes to write up.
              </p>
            </div>
            <LinkRow icon={Calendar} label="Back to the schedule" href="/schedule" />
          </FlatBlock>
        </div>
      </>
    )
  }

  // The money — what's owed, what it's worth, whether cards are on — is the
  // session page's business now, one screen back. This screen writes the
  // session up; it only needs the currency for the time-tracking subline.

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

  const currency = profile?.payoutCurrency ?? 'nzd'

  // The logged entries, for the Time row's subline only — the picker itself
  // lives on the time screen now, so the member list is loaded there.
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

  // No status word in the header. "Upcoming" is the default state of most
  // sessions, so it told the trainer nothing, and every state it CAN show is
  // already said by the Complete / Invoice cells directly below it — the page
  // must not say the same thing twice (AGENTS.md).

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
      {/* The five bottom tabs stand down while you're writing up a session
          (Karl: "no nav bar on these please"). Same reasoning as the class
          register next door: they offer to go somewhere ELSE, which is the one
          thing a half-written write-up shouldn't invite. keepTopBar, so the
          back arrow survives as the way out. */}
      <SetPageImmersive value keepTopBar />
      {/* The shell's foot reserve is 5rem for the tabs PLUS the home-indicator
          inset. Only the 5rem goes: this page has no pinned bar at all, so if
          the inset went too the last row of the write-up would sit under the
          home indicator. */}
      <style>{`@media (max-width: 767px) { .pm-main { padding-bottom: env(safe-area-inset-bottom, 0px) !important; } }`}</style>

      {/* Back is the session it belongs to, always — that is the screen the
          trainer pressed "Start notes" on, and it carries its own way back to
          wherever they came from before that. */}
      <PageHeader
        title="Session notes"
        back={{
          href: cameFrom
            ? `/sessions/${trainingSession.id}?from=${encodeURIComponent(cameFrom)}`
            : `/sessions/${trainingSession.id}`,
          label: 'Back to session',
        }}
      />
      {/* Full width. Capped at 5xl the write-up sat in a column down the middle
          of a desktop screen with a third of the room empty either side — and
          the write-up is the whole job of this page, so it gets the room. The
          rail beside it stays 20rem; only the notes column grows. */}
      <div className="p-4 md:p-8 w-full min-w-0">

      {trainingSession.client?.isSample && (
        <div className="mb-4">
          <SampleRecordBadge />
        </div>
      )}

      {/* Two tabs, not two columns (Karl). The facts about the dog and owner
          used to be a sticky rail BESIDE the write-up; they're the first thing
          in the first tab now, above it, at a third of the width. */}
      <SessionScreenTabs
        initialTab={sp.tab === 'previous' ? 'previous' : sp.tab === 'details' ? 'details' : 'notes'}
        details={
        <div>
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
            </div>

            {/* Date, time, duration and — when there IS one — the place, all on
                one row. "In-person" had a row to itself and spent it saying the
                default; a real address is worth showing but not worth a row. */}
            <FactRow
              icon={Calendar}
              accent={accent}
              label={d.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              sub={[
                `${d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })} · ${trainingSession.durationMins} min`,
                trainingSession.sessionType === 'VIRTUAL'
                  // A joinable virtual session gets its own row below, because
                  // that row DOES something. One with no link yet is just a
                  // fact, so it rides here.
                  ? (trainingSession.virtualLink ? null : 'Virtual')
                  : trainingSession.location || null,
              ].filter(Boolean).join(' · ')}
            />

            {/* Only when it DOES something: a virtual session you can join. */}
            {trainingSession.sessionType === 'VIRTUAL' && trainingSession.virtualLink && (
              <LinkRow
                icon={Video}
                accent={accent}
                label="Virtual session"
                href={trainingSession.virtualLink}
                external
                trailingLabel="Join"
              />
            )}

            {/* Complete, Invoice and Take payment used to be a divided strip
                under these facts. They are the session page's full-width
                buttons now — one screen back, where the trainer chose to come
                here. Two copies of "mark this complete" is two places to
                wonder which one you pressed. */}
          </FlatBlock>
        </div>
        }
        previousNotes={
          // What was written last time, between who's in front of you and the
          // form you're filling in — the order a trainer needs them in during
          // a session (Karl). It keeps its own block: it opens and closes, and
          // burying it in "More" would mean leaving the form to read it.
          previousSessions.length > 0 ? (
            <FlatBlock>
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
            </FlatBlock>
          ) : null
        }
        writeUp={
        <>
          {/* What this session covers, when the offering runs a curriculum —
              above the write-up, because it is the thing the trainer checks
              BEFORE the session, and the place a step gets skipped for a dog
              that already has it. Renders nothing on an ordinary session. */}
          <SessionSeriesStep sessionId={trainingSession.id} />

          {/* The write-up itself — the one thing on this page that earns a
              block of its own. */}
          {notesOn && (
            <FlatBlock>
              <SessionFormReport sessionId={trainingSession.id} sessionStatus={trainingSession.status} layout="inline" autoPromptIfEmpty />
            </FlatBlock>
          )}
        </>
        }
        more={
        <>
          {/* Everything else, as rows that open. A section with nothing in it
              costs one line; a section with content opens on arrival. */}
          <FlatBlock>
            {/* Photos open in a modal on the session screen, with the
                thumbnails alongside it — one home. This row says what's there
                and points at it. */}
            <LinkRow
              icon={Paperclip}
              accent={accent}
              label="Photos & video"
              sub={attachmentSub}
              href={`/sessions/${trainingSession.id}`}
            />

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

            {/* Time is logged in a modal on the session screen — one home.
                This row says how much is on the session and points at it. */}
            <LinkRow
              icon={Clock}
              accent={accent}
              label="Time tracking"
              sub={timeSub}
              href={`/sessions/${trainingSession.id}`}
            />


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
              redirectTo={clientId ? `/clients/${clientId}/sessions` : '/schedule'}
            />
          </FlatBlock>
        </>
        }
      />
      </div>
    </>
  )
}
