'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import {
  X, Calendar, Plus, Check, Loader2, Tag, Package as PackageIcon, FileDown,
  PawPrint, Trophy, Info, MessageSquare, StickyNote, FileText, Dumbbell,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FlatBlock, FlatSummaryGrid, FlatSummaryTile } from '@/components/shared/flat-list'
import { SetPageImmersive } from '@/components/shared/page-title'
import { useCurrency } from '@/components/currency-context'
import { formatMoney } from '@/lib/money'
import { effectivePriceCents, resolveVariantPricing } from '@/lib/product-price'
import { isRichTextEmpty, richTextToPlain } from '@/lib/rich-text'
import { formatDate, formatSessionTitle } from '@/lib/utils'
import {
  agoLine, countLine, dogsTileLine, nextSessionLine, notesLine, owingLine,
  type OwingSummary,
} from '@/lib/client-profile-summary'
import { ClientSessionRow, CommunicationRow } from './client-sections'
import { ClientUnpaidInvoicesCard } from './client-invoices'
import type {
  ClientSection, CommItem, Dog, PendingProductRequest, ShopProduct, TrainingSession,
} from './client-profile-types'

interface Props {
  clientId: string
  /** Their name — the one empty state on the screen says it out loud. */
  clientName: string
  canEdit: boolean
  dogs: Dog[]
  sessions: TrainingSession[]
  /** Newest few only — the profile shows three and dates the tile off the first. */
  communications: CommItem[]
  /** Counted, not loaded: the profile only ever prints the number. */
  trainingLogCount: number
  /** Plain-text, already truncated on the server. */
  notesPreview: string | null
  /** Pre-formatted "3 Mar 2026" — the Details tile's line. */
  clientSince: string
  products: ShopProduct[]
  pendingProductRequests: PendingProductRequest[]
  /** Gates the Invoices tile + page and the unpaid-invoices card. */
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
 * A client, as a screen.
 *
 * It used to be nine tabs. Tapping one swapped content *below* the hero and
 * below the grid, so on a phone nothing appeared to happen (Karl, 2026-08-06:
 * "these need to open new pages there is no way people will see the change at
 * the bottom"). Every section is its own route now — see `[section]/page.tsx` —
 * and this screen is what's left: the summary, the actions, and the handful of
 * cards that are genuinely about the client rather than about one section.
 *
 * There is no "Overview" tile. The profile IS the overview, and a tile pointing
 * at the page you are already standing on is the "nothing says the same thing
 * twice" rule broken in the most visible place there is.
 */
export function ClientProfileView({
  clientId,
  clientName,
  canEdit,
  dogs,
  sessions,
  communications,
  trainingLogCount,
  notesPreview,
  clientSince,
  products,
  pendingProductRequests: initialPendingRequests,
  canViewBilling,
  invoiceSummary,
  showAchievements,
  achievementsEarned,
  showComms,
  actions,
}: Props) {
  const [pendingRequests, setPendingRequests] = useState(initialPendingRequests)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null)

  async function dismissRequest(requestId: string) {
    if (busyRequestId) return
    setBusyRequestId(requestId)
    const removed = pendingRequests.find(r => r.id === requestId)
    setPendingRequests(prev => prev.filter(r => r.id !== requestId))
    try {
      const res = await fetch(`/api/product-requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      })
      if (!res.ok && removed) setPendingRequests(prev => [...prev, removed])
    } catch {
      if (removed) setPendingRequests(prev => [...prev, removed])
    } finally {
      setBusyRequestId(null)
    }
  }

  async function addProductRequest(productId: string, variantId: string | null) {
    const res = await fetch(`/api/clients/${clientId}/product-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, variantId }),
    })
    if (!res.ok) return
    const created = await res.json()
    const product = products.find(p => p.id === productId)
    if (!product) return
    const variant = product.variants?.find(v => v.id === variantId) ?? null
    setPendingRequests(prev => {
      if (prev.some(r => r.id === created.id)) return prev
      return [...prev, {
        id: created.id,
        note: created.note ?? null,
        variant: variant ? { id: variant.id, name: variant.name } : null,
        product: { id: product.id, name: product.name, kind: product.kind, imageUrl: product.imageUrl },
      }]
    })
  }

  const now = new Date()
  const overviewNow = now.getTime()
  const upcomingSessions = sessions
    .filter(s => new Date(s.scheduledAt).getTime() >= overviewNow)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
  const latestPastSession = sessions
    .filter(s => new Date(s.scheduledAt).getTime() < overviewNow)
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0] ?? null

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
    ...(showComms ? [{
      id: 'communication' as ClientSection, label: 'Comms', icon: MessageSquare,
      // When, not how many: the list here is the newest few, so a total would
      // be a guess — the newest entry's date is exact either way.
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

  // ── What the profile shows below the tiles ────────────────────────────────
  //
  // A card whose only content is the word "no" does not render (Karl, looking
  // at a screenshot of five stacked empty cards: "what can we do with this?").
  // A full-width card, a heading and a line spent on the absence of news is
  // chrome that has earned no space.
  //
  // The line between these cards and the tiles above them, because it decides
  // what belongs where: **the tiles carry the summary, these carry the
  // detail.** The Sessions tile says when the next one is; this card lists them
  // with their times. The Invoices tile says what is owed; this card lists each
  // invoice with "Mark paid" on it. A card that could only ever restate its own
  // tile has no reason to exist — which is why the empty variants are gone
  // rather than reworded.
  //
  // Ordered by what wants a trainer's attention rather than by a fixed list:
  // money owed first (it is an exception — it only appears when there IS some),
  // then what's coming up, then what to hand over, then what happened last,
  // then chatter.
  const cards: { key: string; node: React.ReactNode }[] = [
    ...(canViewBilling && invoiceSummary.count > 0 ? [{
      key: 'invoices',
      node: <ClientUnpaidInvoicesCard clientId={clientId} viewAllHref={`/clients/${clientId}/invoices`} />,
    }] : []),
    ...(upcomingSessions.length > 0 ? [{
      key: 'upcoming',
      node: (
        <FlatBlock>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Upcoming sessions</h2>
            <Link href={`/clients/${clientId}/sessions`} className="text-xs font-medium text-blue-600 hover:underline">
              View all
            </Link>
          </div>
          {upcomingSessions.slice(0, 4).map(s => (
            <ClientSessionRow key={s.id} session={s} className="rounded-none px-4 py-2.5" />
          ))}
        </FlatBlock>
      ),
    }] : []),
    // The EXCEPTION to "hide an empty card": "Add product" is the only route on
    // this screen to hand something over, so the card stays for as long as the
    // trainer has a shop to pick from — the action is the point, not the list.
    // It goes only when there are no products at all, where its empty line was
    // shop onboarding ("add some to your shop") rather than anything about this
    // client, and /products is one tap away in the menu regardless.
    ...(canEdit && (pendingRequests.length > 0 || products.length > 0) ? [{
      key: 'bring',
      node: (
        <Card>
          <CardBody className="py-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Bring to next session</h2>
              {products.length > 0 && (
                <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add product
                </Button>
              )}
            </div>
            {/* No "nothing pending" line: "Add product" is right beside the
                heading, and an empty state next to the action that resolves it
                says the same thing twice. The ACTION is what has to survive. */}
            {pendingRequests.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {pendingRequests.map(r => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 bg-amber-50 border border-amber-100 pl-3 pr-1.5 py-1 rounded-full"
                    title={r.note ?? undefined}
                  >
                    {/* The option is part of the name here — "a harness" is not
                        something anyone can go and fetch. */}
                    {r.variant ? `${r.product.name} — ${r.variant.name}` : r.product.name}
                    <button
                      onClick={() => dismissRequest(r.id)}
                      disabled={busyRequestId === r.id}
                      aria-label={`Remove ${r.product.name}`}
                      className="ml-1 h-5 w-5 rounded-full hover:bg-amber-100 flex items-center justify-center text-amber-700 disabled:opacity-50"
                    >
                      {busyRequestId === r.id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <X className="h-3 w-3" />}
                    </button>
                  </span>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      ),
    }] : []),
    ...(latestPastSession ? [{
      key: 'latest',
      node: (
        <Card>
          <CardBody className="py-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Latest session</h2>
            <Link href={`/sessions/${latestPastSession.id}`} className="group block">
              <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
                <p className="text-sm font-medium text-slate-900 group-hover:underline">{formatSessionTitle(latestPastSession.title)}</p>
                <span className="text-xs text-slate-400">{formatDate(latestPastSession.scheduledAt)}</span>
              </div>
              {!isRichTextEmpty(latestPastSession.description) ? (
                <p className="line-clamp-3 text-sm text-slate-600">{richTextToPlain(latestPastSession.description)}</p>
              ) : (
                // Kept: there is no action beside this line, and it explains
                // where the recap gets written rather than restating a zero.
                <p className="text-sm text-slate-400">No notes recorded — open the session to add a recap.</p>
              )}
            </Link>
          </CardBody>
        </Card>
      ),
    }] : []),
    ...(communications.length > 0 ? [{
      key: 'comms',
      node: (
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
      ),
    }] : []),
  ]

  const firstName = clientName.split(' ')[0] || clientName

  return (
    <>
      {/* The five bottom tabs and the global "+" stand down for as long as this
          screen is open (Karl: "think lets hide the nav bar"). keepTopBar, so
          the shell's phone bar survives stripped back to the back arrow and the
          client's name — with the tabs gone that is the only way off the
          screen, and an immersive page without one is a dead end. */}
      <SetPageImmersive value keepTopBar />
      {/* The shell reserves 5rem at the foot of every phone screen for the tab
          bar. It isn't there, so that reservation is a band of nothing. */}
      <style>{`@media (max-width: 767px) { .pm-main { padding-bottom: 0 !important; } }`}</style>

      {/* The summary grid. Two columns on a small phone, three from phablet
          width, four once there's desktop room.
          This is the screen's centre of gravity: it answers "how is this client
          doing?" without opening anything, and each tile is the way in to its
          own page. On a phone it overlaps the hero above it by 28px, the same
          way the client app's own quick actions do, so the photo and the facts
          read as one block rather than two stacked panels. */}
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

      {/* Assign, and a ⋯ for the occasional actions. */}
      {actions && <div className="mb-6">{actions}</div>}

      <div className="flex flex-col gap-6">
        {cards.length > 0
          ? cards.map(c => <Fragment key={c.key}>{c.node}</Fragment>)
          : (
            /* All five cards had nothing in them, which is the commonest state
               there is: a trainer who added this client a minute ago. Five
               headings above five apologies is not a screen — one purposeful
               block is. COPY IS PLACEHOLDER pending Karl. */
            <FlatBlock className="px-5 py-10 text-center">
              <div className="mx-auto flex max-w-xs flex-col items-center gap-2">
                <PawPrint className="h-7 w-7 text-slate-300" strokeWidth={1.75} />
                <p className="text-base font-semibold text-slate-900">Nothing yet for {firstName}</p>
                <p className="text-sm leading-snug text-slate-500">
                  {canEdit
                    ? 'No sessions, invoices or messages on file. Assign a session with the button above, or send them a message to get started.'
                    : 'No sessions, invoices or messages on file yet.'}
                </p>
                <Link
                  href={`/messages?client=${clientId}`}
                  className="mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <MessageSquare className="h-4 w-4" strokeWidth={1.75} /> Send a message
                </Link>
              </div>
            </FlatBlock>
          )}
      </div>

      {pickerOpen && (
        <ProductPickerModal
          products={products}
          // A varianted product is "added" per OPTION, so the two sets are
          // separate: the product row only greys out for things sold as one
          // thing. A client can have the Small and then also want the Large.
          requestedIds={new Set(pendingRequests.filter(r => !r.variant).map(r => r.product.id))}
          requestedVariantIds={new Set(pendingRequests.map(r => r.variant?.id).filter((id): id is string => !!id))}
          onClose={() => setPickerOpen(false)}
          onPick={async (id, variantId) => { await addProductRequest(id, variantId) }}
        />
      )}
    </>
  )
}

function ProductPickerModal({
  products,
  requestedIds,
  requestedVariantIds,
  onClose,
  onPick,
}: {
  products: ShopProduct[]
  requestedIds: Set<string>
  /** Options already on order for this client. */
  requestedVariantIds: Set<string>
  onClose: () => void
  onPick: (productId: string, variantId: string | null) => void | Promise<void>
}) {
  const currency = useCurrency()
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  // A product with options OPENS instead of adding — the options appear
  // underneath it, in the same list. A second modal on top of this one to ask
  // "which size?" would be a sheet over a sheet, and the answer is three rows
  // long.
  const [openId, setOpenId] = useState<string | null>(null)

  const filtered = products.filter(p =>
    !search.trim() || p.name.toLowerCase().includes(search.toLowerCase())
      || (p.category ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const groups: { category: string | null; items: ShopProduct[] }[] = []
  const seen = new Set<string | null>()
  for (const p of filtered) {
    const key = p.category ?? null
    if (!seen.has(key)) {
      seen.add(key)
      groups.push({ category: key, items: filtered.filter(x => (x.category ?? null) === key) })
    }
  }

  async function pick(id: string, variantId: string | null = null) {
    setBusyId(variantId ?? id)
    try { await onPick(id, variantId) }
    finally { setBusyId(null) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-900">Add to next session</h2>
            <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="px-5 py-4">
          {filtered.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No products match.</p>
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map(g => (
                <div key={g.category ?? '_'}>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-2 flex items-center gap-1.5">
                    <Tag className="h-3 w-3" /> {g.category ?? 'Uncategorised'}
                  </p>
                  <div className="flex flex-col">
                    {g.items.map(p => {
                      const variants = p.variants ?? []
                      const already = requestedIds.has(p.id)
                      const expanded = openId === p.id
                      return (
                        <div key={p.id}>
                        <button
                          onClick={() => {
                            if (already) return
                            if (variants.length > 0) { setOpenId(expanded ? null : p.id); return }
                            void pick(p.id)
                          }}
                          disabled={already || busyId === p.id}
                          className={`flex w-full items-center gap-3 px-2 py-2 -mx-2 rounded-xl text-left transition-colors ${
                            already ? 'opacity-60 cursor-default' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {p.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                            ) : p.kind === 'DIGITAL' ? (
                              <FileDown className="h-4 w-4 text-violet-500" />
                            ) : (
                              <PackageIcon className="h-4 w-4 text-amber-600" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate flex items-center gap-1.5">
                              <span className="truncate">{p.name}</span>
                              {!p.active && (
                                <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title="Hidden from the client's shop — you can still add it">
                                  Hidden
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-slate-500">
                              {p.priceCents != null ? formatMoney(p.priceCents, currency) : 'Contact'}
                              {' · '}
                              {p.kind === 'DIGITAL' ? 'Digital' : 'Physical'}
                              {variants.length > 0 && ` · ${variants.length} options`}
                            </p>
                          </div>
                          {already ? (
                            <span className="text-xs font-medium text-emerald-600 flex items-center gap-1 flex-shrink-0">
                              <Check className="h-3.5 w-3.5" /> Added
                            </span>
                          ) : busyId === p.id ? (
                            <Loader2 className="h-4 w-4 animate-spin text-slate-400 flex-shrink-0" />
                          ) : variants.length > 0 ? (
                            <span className="text-xs text-slate-400 flex-shrink-0">{expanded ? 'Hide' : 'Choose'}</span>
                          ) : (
                            <Plus className="h-4 w-4 text-slate-400 flex-shrink-0" />
                          )}
                        </button>

                        {expanded && (
                          <div className="ml-13 mb-1 overflow-hidden rounded-xl border border-slate-200 divide-y divide-slate-100">
                            {variants.map(v => {
                              const on = requestedVariantIds.has(v.id)
                              const cents = effectivePriceCents(resolveVariantPricing(p, v))
                              return (
                                <button
                                  key={v.id}
                                  onClick={() => !on && pick(p.id, v.id)}
                                  disabled={on || busyId === v.id}
                                  className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                                    on ? 'opacity-60 cursor-default' : 'hover:bg-slate-50'
                                  }`}
                                >
                                  <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{v.name}</span>
                                  <span className="flex-shrink-0 text-xs tabular-nums text-slate-500">
                                    {cents != null ? formatMoney(cents, currency) : 'Contact'}
                                    {v.stockCount != null && ` · ${v.stockCount} left`}
                                  </span>
                                  {on ? (
                                    <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                                  ) : busyId === v.id ? (
                                    <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-slate-400" />
                                  ) : (
                                    <Plus className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
