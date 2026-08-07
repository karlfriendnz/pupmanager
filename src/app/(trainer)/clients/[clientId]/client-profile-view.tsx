'use client'

import {
  Calendar, PawPrint, Trophy, Info, MessageSquare, StickyNote, FileText, Dumbbell,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react'
import { FlatSummaryGrid, FlatSummaryTile } from '@/components/shared/flat-list'
import { SetPageImmersive } from '@/components/shared/page-title'
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
      <div className="relative z-20 -mt-7 mb-4 lg:mt-0">
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

      {/* Assign, and a ⋯ for the occasional actions. The last thing on the
          screen — there is nothing below it any more. */}
      {actions}
    </>
  )
}
