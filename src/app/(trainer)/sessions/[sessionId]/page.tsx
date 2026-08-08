import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Calendar, Video, PawPrint, NotebookPen, Users, History } from 'lucide-react'
import { formatSessionTitle, personLabel } from '@/lib/utils'
import { runSessionHref, runHref, runKind, runKindLabel } from '@/lib/run-kind'
import { hasAddon } from '@/lib/billing'
import { PaySessionButton } from './pay-session-button'
import { LinkRow, PrimaryActionButton, ContactStrip } from './session-rows'
import { LogTimeRow } from './log-time-row'
import { AddPhotosRow } from './add-photos-row'
import { ensureTimeMembers } from './time-members'
import { SessionWhenRow } from './session-when'
import { CompleteButton, InvoiceButton } from './session-buttons'
import { DeleteSessionRow } from './session-actions'
import { FlatBlock, SectionLabel } from '@/components/shared/flat-list'
import { PageHeader } from '@/components/shared/page-header'
import { SampleRecordBadge } from '@/components/sample-record-badge'
import { SetPageImmersive } from '@/components/shared/page-title'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Session' }

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/**
 * A 1:1 session, opened from the calendar. Five parts, in this order (Karl,
 * 2026-08-08): who and when, start notes, take attendance when the offering
 * has more than one dog in the room, mark as complete, invoice.
 *
 * It is a LANDING screen, not a form: every part of it is one tap wide, so a
 * trainer standing in a field with a dog on a lead can hit the one they want
 * without reading a page first. The write-up — which is long, holds unsaved
 * text and wants the whole screen — lives one tap away at ./notes.
 */
export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const { sessionId } = await params

  // Where Back goes. The calendar sends `?from=/schedule?date=…`, so Back
  // returns to the week you were looking at rather than to the client's list.
  //
  // Only an in-app path is honoured: `from` arrives in the URL, so anything
  // else is an open redirect wearing a Back button, and `//host` is a
  // protocol-relative URL that leaves the site while looking like a path.
  const rawFrom = (await searchParams).from
  const cameFrom = rawFrom && rawFrom.startsWith('/') && !rawFrom.startsWith('//') ? rawFrom : null

  // Tenant scope only. Do NOT also filter on `clientId: { not: null }` — a
  // GROUP-CLASS session has clientId null BY DESIGN (schema: attendance is
  // per-enrollee via SessionAttendance), so that filter 404'd every class
  // session in the app. The two null-client cases are told apart below by
  // `classRunId`.
  const trainingSession = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId },
    include: {
      // A session on a run: the cohort's name, and the backing package that
      // says WHICH kind of offering it is (class, casual, daycare, event).
      classRun: {
        select: {
          id: true,
          name: true,
          package: {
            select: {
              isGroup: true, allowDropIn: true, sessionCount: true,
              recurrenceRule: true, isPuppySchool: true, isEvent: true,
            },
          },
        },
      },
      client: { select: { id: true, isSample: true, phone: true, user: { select: { name: true, email: true } } } },
      dog: {
        select: {
          name: true,
          photoUrl: true,
          primaryFor: { take: 1, select: { id: true, user: { select: { name: true, email: true } } } },
        },
      },
      // Extra dogs attending alongside the primary one. More than one dog in
      // the room is what makes attendance a question worth asking.
      buddies: { select: { id: true } },
      // Photos and time both open in a modal on this screen, so their content
      // comes down with the page rather than behind a fetch.
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

  // A session on a RUN — a class, a casual class, a daycare day, an event —
  // lands HERE too, on the same five parts (Karl, 2026-08-08: "when you click
  // on a class it's not going to a different layout to the 1:1 session… this
  // should be consistent across all offering types with some slight
  // differences"). It used to redirect straight into the register, so a class
  // and a 1:1 answered the same tap with two different screens.
  //
  // The differences are in what the parts SAY and where the buttons go, not in
  // the shape: a cohort has a name instead of a dog, always has attendance to
  // take, and its write-ups are per client on the register screen.
  const run = trainingSession.classRunId && trainingSession.classRun
    ? trainingSession.classRun
    : null
  const runKindName = run ? runKindLabel(run.package) : null

  // Who is expected. A full enrolment has no dropInSessionId; a drop-in is
  // attached to THIS session — the same two shapes the register counts.
  const enrolledCount = run
    ? await prisma.classEnrollment.count({
        where: {
          classRunId: run.id,
          status: 'ENROLLED',
          OR: [{ dropInSessionId: null }, { dropInSessionId: trainingSession.id }],
        },
      })
    : 0

  // Neither a client nor a class: the client was deleted and the session was
  // left behind. There's nothing to act on, but a bare 404 for a row a trainer
  // just tapped reads as a bug. Say what happened instead.
  if (!run && !trainingSession.clientId && !trainingSession.dog) {
    return (
      <>
        <PageHeader title="Session" back={{ href: '/schedule', label: 'Back to schedule' }} />
        <div className="p-4 md:p-8 w-full max-w-2xl mx-auto">
          <FlatBlock>
            <div className="px-4 py-4">
              <p className="text-sm font-medium text-slate-900">This session has no client</p>
              <p className="mt-1 text-[13px] text-slate-500">
                {formatSessionTitle(trainingSession.title)} on{' '}
                {trainingSession.scheduledAt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}.
                Its client was removed, so there is nothing to write up or bill.
              </p>
            </div>
            <LinkRow icon={Calendar} label="Back to the schedule" href="/schedule" />
          </FlatBlock>
        </div>
      </>
    )
  }

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
  // fallback the button would simply never appear for those. So we open a
  // normal sale instead, seeded with what this session is worth.
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

  // Session notes are gated by the Notes add-on (default-on). With it off there
  // is no write-up to start, so the button that offers one goes too.
  const notesOn = await hasAddon(trainerId, 'notes')

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

  // Attendance is a question worth asking whenever more than one dog is in the
  // room: every session of a run, and a 1:1 with buddies on it. A plain 1:1 has
  // exactly one dog and the answer is "they came, or the session didn't
  // happen", which Complete already says.
  const buddyCount = trainingSession.buddies.length
  const canTakeAttendance = run != null || buddyCount > 0

  // Where the two top buttons go, per kind.
  //
  // A RUN keeps its register: attendance and the per-client write-ups both
  // live there, because a cohort's notes are written one enrollee at a time.
  // `write=1` lands the same screen on "who am I writing up", so the two
  // buttons don't just repeat each other.
  //
  // An EVENT has no per-session screen by definition (one session, so its run
  // page IS the session) — both buttons go to the event's roster.
  const runScreenHref = run ? runSessionHref(run.id, trainingSession.id, run.package) : null
  const isEventRun = run ? runKind(run.package) === 'event' : false
  const notesHref = run
    // An event's roster has no write-up mode to land on, so it gets the plain
    // page rather than a parameter that does nothing.
    ? (isEventRun ? runScreenHref! : `${runScreenHref}?write=1`)
    : cameFrom
      ? `/sessions/${trainingSession.id}/notes?from=${encodeURIComponent(cameFrom)}`
      : `/sessions/${trainingSession.id}/notes`
  const attendanceHref = run ? runScreenHref! : `/sessions/${trainingSession.id}/attendance`

  const attachments = trainingSession.attachments.map(a => ({
    id: a.id,
    kind: a.kind,
    url: a.url,
    thumbnailUrl: a.thumbnailUrl,
    caption: a.caption,
    sizeBytes: a.sizeBytes,
    durationMs: a.durationMs,
    createdAt: a.createdAt.toISOString(),
  }))

  // Time is logged in a modal on this screen, so its entries and the people it
  // can be logged against come down with the page.
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
  const timeMembers = (await ensureTimeMembers(trainerId)).map(m => ({ id: m.id, name: personLabel(m.user) }))

  // The client this session belongs to — directly, or through the dog's
  // primary owner (an ad-hoc session can carry only a dog).
  const contactClientId = trainingSession.clientId ?? trainingSession.dog?.primaryFor[0]?.id ?? null

  // When this client was last written up. It is the thing a trainer wants
  // BEFORE they start writing — "what did we do last time" — so the session
  // screen carries a door to it with the date on it, and the notes themselves
  // stay in one home on the write-up's Previous tab.
  const lastWriteUp = contactClientId
    ? await prisma.trainingSession.findFirst({
        where: {
          clientId: contactClientId,
          id: { not: trainingSession.id },
          scheduledAt: { lte: trainingSession.scheduledAt },
          status: { in: ['COMPLETED', 'COMMENTED', 'INVOICED'] },
          formResponses: { some: {} },
        },
        orderBy: { scheduledAt: 'desc' },
        select: { scheduledAt: true },
      })
    : null

  const clientUser = trainingSession.client?.user ?? trainingSession.dog?.primaryFor[0]?.user
  const clientName = clientUser ? (clientUser.name ?? clientUser.email) : null
  const d = trainingSession.scheduledAt

  // A run session's title repeats its run: "Puppy School — session 1/6". The
  // name is already the heading, so the subline keeps only what the title adds
  // (the same split the register screen uses). Otherwise the card reads
  // "Puppy School / Class · Puppy School".
  const runSessionLabel = run && trainingSession.title.includes('—')
    ? trainingSession.title.split('—').pop()!.trim().replace(/^session/i, 'Session')
    : null

  return (
    <>
      {/* No bottom tabs here (Karl, 2026-08-08: "the nav bar should not be
          showing on this page"). Same reasoning as the write-up next door: a
          screen you opened to do ONE thing to ONE session shouldn't spend its
          bottom edge offering four other places to be. keepTopBar, so the back
          arrow survives as the way out. */}
      <SetPageImmersive value keepTopBar />
      {/* The shell reserves 5rem at the foot for those tabs plus the home
          indicator inset. Only the 5rem goes: with the inset gone too, the last
          button would sit under the home indicator. */}
      <style>{`@media (max-width: 767px) { .pm-main { padding-bottom: env(safe-area-inset-bottom, 0px) !important; } }`}</style>

      <PageHeader
        title="Session"
        back={
          cameFrom
            ? { href: cameFrom, label: cameFrom.startsWith('/schedule') ? 'Back to schedule' : 'Back' }
            : run
              ? { href: runHref(run.id, run.package), label: `Back to ${runKindName?.toLowerCase() ?? 'class'}` }
              : trainingSession.clientId
                ? { href: `/clients/${trainingSession.clientId}/sessions`, label: 'Back to client' }
                : { href: '/schedule', label: 'Back to schedule' }
        }
      />

      {/* Capped, and centred on a desktop: this screen is a short column of
          full-width buttons, and a button stretched across 1400px of monitor
          is not a bigger button, it is a worse one. */}
      <div className="p-4 md:p-8 w-full max-w-2xl mx-auto flex flex-col gap-3">

        {trainingSession.client?.isSample && <SampleRecordBadge />}

        {/* 1 · Who, and when. A cohort has a name where a 1:1 has a dog — the
            same row either way, so the two screens read as one screen. */}
        <FlatBlock>
          <div className="flex items-center gap-3 px-4 py-3">
            {run ? (
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-slate-100">
                <Users className="h-5 w-5 text-slate-500" strokeWidth={1.75} />
              </span>
            ) : trainingSession.dog?.photoUrl ? (
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
                {run?.name ?? trainingSession.dog?.name ?? clientName ?? 'Session'}
              </span>
              <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                {(run
                  ? [runKindName, runSessionLabel]
                  : [clientName, formatSessionTitle(trainingSession.title)]
                ).filter(Boolean).join(' · ')}
              </span>
            </span>
          </div>

          {/* Message, call, profile — attached to the person named above,
              because that is who they reach. */}
          {!run && contactClientId && (
            <ContactStrip
              clientId={contactClientId}
              phone={trainingSession.client?.phone}
              accent={accent}
            />
          )}

          {/* Date, time, duration and — when there IS one — the place, all on
              one row. "In-person" had a row to itself and spent it saying the
              default; a real address is worth showing but not worth a row.
              Tapping it moves the session (Karl). */}
          <SessionWhenRow
            sessionId={trainingSession.id}
            scheduledAt={d.toISOString()}
            durationMins={trainingSession.durationMins}
            accent={accent}
            extra={[
              trainingSession.sessionType === 'VIRTUAL'
                ? (trainingSession.virtualLink ? null : 'Virtual')
                : trainingSession.location || null,
              // Who's coming is said once, on the attendance button, where it
              // is a reason to tap rather than a fact to read.
              run ? null
                : buddyCount > 0 ? `+${buddyCount} buddy dog${buddyCount === 1 ? '' : 's'}` : null,
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
        </FlatBlock>

        {/* 2 · The one thing this screen is for. The only filled button on
            the page: six identical white rows told a glance nothing about
            which to press (Karl: "it's just not there yet"). */}
        {notesOn && (
          <PrimaryActionButton
            href={notesHref}
            icon={NotebookPen}
            label="Start notes"
            sub={run ? 'Write up each client' : undefined}
          />
        )}

        {/* 3 · The rest of what you do WHILE it's happening, as one block of
            rows rather than a stack of separate bordered buttons (AGENTS.md:
            related things live in one block split by hairlines). */}
        <FlatBlock>
          {canTakeAttendance && (
            <LinkRow
              icon={Users}
              accent={accent}
              label="Take attendance"
              href={attendanceHref}
              trailingLabel={run ? `${enrolledCount} in` : `${buddyCount + 1} dogs`}
            />
          )}
          {lastWriteUp && (
            <LinkRow
              icon={History}
              accent={accent}
              label="Previous notes"
              href={`/sessions/${trainingSession.id}/notes?tab=previous`}
              trailingLabel={lastWriteUp.scheduledAt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
            />
          )}
          <AddPhotosRow
            sessionId={trainingSession.id}
            attachments={attachments}
            accent={accent}
          />
          <LogTimeRow
            sessionId={trainingSession.id}
            entries={timeEntries}
            members={timeMembers}
            accent={accent}
          />
        </FlatBlock>

        {/* 4 · Closing it off — its own group, because these are the ones you
            do at the END, and the last of them can't be taken back. */}
        <div className="mt-2">
          <SectionLabel>Finishing up</SectionLabel>
          <FlatBlock>
            <InvoiceButton
              sessionId={trainingSession.id}
              initialInvoicedAt={trainingSession.invoicedAt?.toISOString() ?? null}
              accent={accent}
            />

            {/* Taking a card is a different act from recording that you billed
                them elsewhere, and only exists when the add-on is on. */}
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
                    // price. Skipped when unpriced — the trainer picks items
                    // instead of starting from a $0 line.
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

            {/* Last, because it is last (Karl: "I think then mark as complete
                is the last step then?"). Completing PUBLISHES the write-up —
                the notes become readable on the client's own screens and the
                client is told — so everything you might still do to this
                session has to have happened above it. */}
            <CompleteButton
              sessionId={trainingSession.id}
              initialStatus={trainingSession.status}
              accent={accent}
            />
          </FlatBlock>
        </div>

        {/* Destructive, so it sits on its own at the very bottom — quiet red
            text, and it asks before it does anything. It came here with the
            write-up's "Details" tab: deleting the session is not part of
            writing it up, and it was the last thing keeping that tab. */}
        <div className="mt-2">
          <FlatBlock>
            <DeleteSessionRow
              sessionId={trainingSession.id}
              redirectTo={run
                ? runHref(run.id, run.package)
                : trainingSession.clientId
                  ? `/clients/${trainingSession.clientId}/sessions`
                  : '/schedule'}
            />
          </FlatBlock>
        </div>
      </div>
    </>
  )
}
