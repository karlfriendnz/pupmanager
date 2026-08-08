'use client'

import {
  Calendar, PawPrint, Trophy, Info, MessageSquare, StickyNote, FileText, Dumbbell,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react'
import { FlatSummaryGrid, FlatSummaryTile } from '@/components/shared/flat-list'
import { SetPageImmersive } from '@/components/shared/page-title'
import Link from 'next/link'
import { Card, CardBody } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { isRichTextEmpty, richTextToPlain } from '@/lib/rich-text'
import { ClientUnpaidInvoicesCard } from './client-invoices'
import { CommunicationRow } from './client-sections'
import { formatMoney } from '@/lib/money'
import {
  agoLine, countLine, dogsTileLine, nextSessionLine, notesLine, owingLine,
  type OwingSummary,
} from '@/lib/client-profile-summary'
import type { ClientSection, CommItem, Dog, TrainingSession } from './client-profile-types'

interface Props {
  clientId: string
  dogs: Dog[]
  sessions: TrainingSession[]
  /** Newest only — the Comms tile dates itself off the first. */
  communications: CommItem[]
  /** Counted, not loaded: the profile only ever prints the number. */
  trainingLogCount: number
  /** How many things are set aside to hand over — the Products tile's line. */
  pendingProductCount: number
  /** Plain-text, already truncated on the server. */
  notesPreview: string | null
  /** Pre-formatted "3 Mar 2026" — the Details tile's line. */
  clientSince: string
  /** Gates the Invoices tile and its page. */
  canViewBilling: boolean
  /** What's still owed, server-summed from the rows the Invoices page lists. */
  invoiceSummary: OwingSummary
  /** The achievements add-on is on. Off means no tile and no page. */
  showAchievements: boolean
  achievementsEarned: number
  /** There's a channel to talk on — the client app, or an email address. */
  showComms: boolean
  /** Assign + the ⋯. A slot, because the server page owns their data. */
  actions?: React.ReactNode
}

/**
 * A client, as a screen: **hero → tiles → the action → the ⋯**. Nothing else.
 *
 * It was nine tabs. Tapping one swapped content *below* the hero and below the
 * grid, so on a phone nothing appeared to happen (Karl, 2026-08-06: "these need
 * to open new pages there is no way people will see the change at the bottom").
 * Every section is its own route now — see `[section]/page.tsx`.
 *
 * Then the content cards went too. Upcoming sessions, unpaid invoices, the last
 * session, recent communication, bring-to-next-session: each was a smaller copy
 * of a page one tap away (Karl: "i dont think we should show this - these
 * things should be on the pages"). With them gone the screen has one job and the
 * duplication problem disappears outright — **the tile says the state, the page
 * holds the content, and nothing is said twice.**
 *
 * "Bring to next session" moved rather than being deleted: it carried the only
 * "Add product" in the app for a specific client, and it now leads the Sessions
 * page, where what to hand over at the next session belongs.
 *
 * There is no "Overview" tile either. The profile IS the overview, and a tile
 * pointing at the page you are already standing on is the same rule again.
 */
export function ClientProfileView({
  clientId,
  dogs,
  sessions,
  communications,
  trainingLogCount,
  pendingProductCount,
  notesPreview,
  clientSince,
  canViewBilling,
  invoiceSummary,
  showAchievements,
  achievementsEarned,
  showComms,
  actions,
}: Props) {
  const now = new Date()

  // Split once, for the desktop cards below. `sessions` is already here for the
  // tiles' lines, so neither costs a query.
  // No cancelled state to filter out: a session here is UPCOMING, COMPLETED,
  // COMMENTED or INVOICED (see SessionStatus), so the split is purely by date.
  const upcomingSessions = sessions
    .filter(x => new Date(x.scheduledAt) >= now)
    .sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt))
  const latestPastSession = sessions
    .filter(x => new Date(x.scheduledAt) < now)
    .sort((a, b) => +new Date(b.scheduledAt) - +new Date(a.scheduledAt))[0] ?? null

  // ── What each tile SAYS ────────────────────────────────────────────────────
  //
  // The grid used to be nine bare labels — a menu with not one fact about the
  // client on it. Every tile now carries its own number or state, worked out
  // from data this screen already has (or, for the two that needed it, a single
  // server aggregate). Anything that would have cost a pile of extra queries
  // says nothing rather than guessing: a wrong count on a client's record is
  // worse than no count.
  //
  // The lines themselves live in lib/client-profile-summary.ts so a unit test
  // can pin `now` and hold every zero state to "words, not 0".
  const tiles: { id: ClientSection; label: string; icon: LucideIcon; sub: string }[] = [
    { id: 'sessions', label: 'Sessions', icon: Calendar, sub: nextSessionLine(sessions, now) },
    {
      id: 'training', label: 'Training log', icon: Dumbbell,
      sub: countLine(trainingLogCount, 'entry', 'entries', 'No practice logged'),
    },
    {
      id: 'dogs', label: dogs.length > 1 ? 'Dogs' : 'Dog', icon: PawPrint,
      sub: dogsTileLine(dogs, now),
    },
    {
      id: 'products', label: 'Products', icon: ShoppingBag,
      sub: countLine(pendingProductCount, 'to bring', 'to bring', 'Nothing to bring'),
    },
    ...(showComms ? [{
      id: 'communication' as ClientSection, label: 'Comms', icon: MessageSquare,
      // When, not how many: this list is the newest entry only, so a total
      // would be a guess — its date is exact either way, and it covers both
      // halves of the page it opens (a message OR an email, whichever is newer).
      sub: agoLine(communications[0]?.date ?? null, now, 'Not spoken yet'),
    }] : []),
    { id: 'notes', label: 'Notes', icon: StickyNote, sub: notesLine(notesPreview) },
    ...(canViewBilling ? [{
      id: 'invoices' as ClientSection, label: 'Invoices', icon: FileText,
      sub: owingLine(invoiceSummary, formatMoney),
    }] : []),
    ...(showAchievements ? [{
      id: 'achievements' as ClientSection, label: 'Achievements', icon: Trophy,
      sub: countLine(achievementsEarned, 'earned', 'earned', 'None earned yet'),
    }] : []),
    { id: 'details', label: 'Details', icon: Info, sub: `Since ${clientSince}` },
  ]

  return (
    <>
      {/* The five bottom tabs and the global "+" stand down for as long as this
          screen is open (Karl: "think lets hide the nav bar"). keepTopBar, so
          the shell's phone bar survives stripped back to the back arrow and the
          client's name — with the tabs gone that is the only way off the
          screen, and an immersive page without one is a dead end. */}
      <SetPageImmersive value keepTopBar />
      {/* The shell's foot reserve is 5rem for the tab bar PLUS the
          home-indicator inset. Only the 5rem goes — this screen has no pinned
          bar to hold that strip itself, so zeroing both put the last row under
          the home indicator (Karl: "no safe space"). */}
      <style>{`@media (max-width: 767px) { .pm-main { padding-bottom: env(safe-area-inset-bottom, 0px) !important; } }`}</style>

      {/* The summary grid. Two columns on a small phone, three from phablet
          width, four once there's desktop room.
          This is the screen: it answers "how is this client doing?" without
          opening anything, and each tile is the way in to its own page. On a
          phone it overlaps the hero above it by 28px, the same way the client
          app's own quick actions do, so the photo and the facts read as one
          block rather than two stacked panels. */}
      {/* DESKTOP: the same tab strip the offering screens wear (Karl: "make the
          client page have the same tab view as the sessions etc for desktop").
          They're LINKS, because each section is genuinely its own page — so
          the URL is shareable and a middle-click opens one in a tab, and there
          is no second copy of any section's content to keep in step.

          Built from the same list as the tiles below, so the gating can't
          drift: no Invoices tab without billing permission, no Comms without a
          channel, no Achievements without the add-on.

          PHONE keeps the tiles: nine tabs do not fit a 390px row, and a tile
          carries a line of state ("$116.00 owing") that a tab cannot. */}
      {/* The tiles are the phone's navigation — hidden once the tabs above take
          that job, rather than showing both. */}
      <div className="relative z-20 -mt-7 mb-4 md:hidden lg:mt-0">
        <FlatSummaryGrid>
          {tiles.map(t => (
            <FlatSummaryTile
              key={t.id}
              icon={t.icon}
              label={t.label}
              sub={t.sub}
              href={`/clients/${clientId}/${t.id}`}
            />
          ))}
        </FlatSummaryGrid>
      </div>

      {/* ── The cards, DESKTOP ONLY ────────────────────────────────────────
          Karl, on the desktop profile: "really really don't like this page…
          can we restore but make the cards dynamic so if there is nothing to
          show then they don't show but if there is something then show".

          A phone gets hero → tiles → action and nothing else; that is the
          screen he asked for and likes. On a 1444px-wide <main> the same
          layout was a 318px photo, nine buttons and 419px of empty screen
          (measured), because every card that used to fill it was deleted when
          the tiles arrived.

          So they come back above md, and each one still earns its place the
          way it always did — the conditions below are the originals, not new
          ones. An empty card is worse than no card: it is a promise of
          content that isn't there.

          Deliberately NOT restored: the "Bring to next session" card. It was
          interactive (pick a product, dismiss a request) and that whole job
          moved to the Products section page, which owns it now. Bringing back
          a second copy is how two screens drift apart. */}
      {/* Full width of this column, stacked (Karl: "the desktop cards should
          be full width on 2nd column"). The page already splits hero-left /
          content-right; giving the cards a column of their OWN inside that
          made a third one 349px wide, which truncated invoice descriptions to
          "Hear…", overflowed "Mark paid" and crushed a message row to four
          words a line. A card here holds a table and a row of buttons — it
          wants the width. */}
      <div className="mb-4 hidden w-full flex-col gap-4 md:flex">
        {canViewBilling && invoiceSummary.count > 0 && (
          <ClientUnpaidInvoicesCard clientId={clientId} viewAllHref={`/clients/${clientId}/invoices`} />
        )}

        {upcomingSessions.length > 0 && (
          <Card>
            <CardBody className="py-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">Coming up</h2>
                <Link href={`/clients/${clientId}/sessions`} className="text-xs font-medium text-blue-600 hover:underline">
                  View all
                </Link>
              </div>
              <div className="flex flex-col gap-2">
                {upcomingSessions.slice(0, 3).map(x => (
                  <Link key={x.id} href={`/sessions/${x.id}`} className="group flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-slate-900 group-hover:underline">{x.title}</span>
                    <span className="text-xs text-slate-400">{formatDate(x.scheduledAt)}</span>
                  </Link>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        {latestPastSession && (
          <Card>
            <CardBody className="py-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Latest session</h2>
              <Link href={`/sessions/${latestPastSession.id}`} className="group block">
                <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
                  <p className="text-sm font-medium text-slate-900 group-hover:underline">{latestPastSession.title}</p>
                  <span className="text-xs text-slate-400">{formatDate(latestPastSession.scheduledAt)}</span>
                </div>
                {!isRichTextEmpty(latestPastSession.description) ? (
                  <p className="line-clamp-3 text-sm text-slate-600">{richTextToPlain(latestPastSession.description)}</p>
                ) : (
                  // Kept, unlike the other zero states: there is no action
                  // beside this line, and it says where the recap gets written
                  // rather than restating a zero.
                  <p className="text-sm text-slate-400">No notes recorded — open the session to add a recap.</p>
                )}
              </Link>
            </CardBody>
          </Card>
        )}

        {communications.length > 0 && (
          <Card>
            <CardBody className="py-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">Recent communication</h2>
                <Link href={`/clients/${clientId}/communication`} className="text-xs font-medium text-blue-600 hover:underline">
                  View all
                </Link>
              </div>
              <div className="flex flex-col gap-2">
                {communications.slice(0, 3).map(c => <CommunicationRow key={c.id} item={c} />)}
              </div>
            </CardBody>
          </Card>
        )}
      </div>

      {/* Assign, and a ⋯ for the occasional actions. */}
      {actions}
    </>
  )
}
