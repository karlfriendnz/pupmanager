import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Card, CardBody } from '@/components/ui/card'
import { Bell, Sparkles } from 'lucide-react'
import { PhoneRowList } from '@/components/shared/flat-list'
import { iconForNotification } from '@/components/shared/notification-icon'
import { RichText } from '@/components/shared/rich-text'
import { PageHeader } from '@/components/shared/page-header'
import { PageTabs } from '@/components/shared/page-tabs'
import { formatDate } from '@/lib/utils'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Notifications' }

const TABS = [
  { id: 'feed', label: 'Notifications' },
  { id: 'whats-new', label: "What's new" },
] as const
type TabId = (typeof TABS)[number]['id']

// The trainer's in-app notification feed — the same Notification model the
// client feed uses, keyed by the signed-in user. Populated by notifyTrainer for
// any type that lists IN_APP (client logged training, new message/enquiry, …).
// Opening the page marks everything read so the nav badge clears.
//
// ── The "What's new" tab ─────────────────────────────────────────────────────
// A platform announcement arrives as one more row in the feed and then scrolls
// away, so there was nowhere to GO and read what changed — the marketing site's
// /changelog was the only such place, and it is written for people who are not
// customers yet.
//
// It reads the announcements that were already sent rather than a list kept
// here. A hand-maintained copy is how the client Help page ended up describing
// "My Diary" years after that screen was deleted (audit C-6) — and it would mean
// writing the same words twice, once to broadcast and once to keep.
//
// Tabs are LINKS, not state: ?tab=whats-new is a URL you can send someone, and
// the notification about a release can point straight at it.
export default async function TrainerNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const userId = session.user.id

  const { tab: rawTab } = await searchParams
  const tab: TabId = rawTab === 'whats-new' ? 'whats-new' : 'feed'

  const notifications =
    tab === 'feed'
      ? await prisma.notification.findMany({
          // Chats are their own thing — they live in Messages, not this feed (they
          // still push + toast). Everything else surfaces here.
          //
          // NULL-safe: `type != 'NEW_MESSAGE'` in SQL never matches a NULL type, and
          // Prisma's `not`/`NOT` both compile to that — so either one silently hides
          // every typed-null notification, which is exactly what "Payment received"
          // rows are (created without a type). That emptied the whole feed for
          // trainers whose only notifications were payments. The explicit null branch
          // keeps them; only real NEW_MESSAGE rows are dropped.
          where: { userId, OR: [{ type: null }, { type: { not: 'NEW_MESSAGE' } }] },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      : []

  // SENT only — a draft is something Karl is still writing. Client-only
  // announcements are somebody else's news and never reach this page.
  const releases =
    tab === 'whats-new'
      ? await prisma.announcement.findMany({
          where: { status: 'SENT', audience: { in: ['ALL_TRAINERS', 'EVERYONE'] } },
          orderBy: { sentAt: 'desc' },
          select: { id: true, title: true, body: true, link: true, sentAt: true, createdAt: true },
          take: 50,
        })
      : []

  // Clear the unread badge — mark after loading so this render still shows which
  // were new (readAt was null when we read them). Only the feed tab: reading
  // what's new is not the same as reading your notifications.
  const unreadIds = notifications.filter(n => !n.readAt).map(n => n.id)
  if (unreadIds.length > 0) {
    await prisma.notification.updateMany({ where: { id: { in: unreadIds } }, data: { readAt: new Date() } })
  }

  return (
    // Full width, like every other list. A notification row is a title, a
    // sentence of body and a date, and it was running down a 768px column with
    // the body wrapping to three lines while half the screen sat empty.
    <>
    {/* The page's own <h1> is gone: every other trainer screen gets its title
        from PageHeader, which feeds the desktop top bar and the phone bar
        rather than printing a second one in the page. This was the "headers
        look different" half of Karl's note. PageHeader is a SIBLING of the
        content wrapper, per its own layout contract. */}
    <PageHeader title="Notifications" />
    {/* Laid out like Messages and To do: the strip goes hard against the
        control bar and stays there while the list scrolls under it, rather
        than floating inside the page's padding. The negative margin gives back
        <main>'s top reserve — min(inset, 1rem) it holds for pages with no bar
        of their own — which is a band of white on a notched phone and nothing
        at all in a browser. */}
    <div className="sticky top-[calc(env(safe-area-inset-top,0px)+3.5rem+1px)] md:top-[var(--app-top-offset,0px)] z-20 -mt-[calc(min(env(safe-area-inset-top,0px),1rem))] md:mt-0 bg-white px-5 lg:px-8">
      <PageTabs
        label="Notification sections"
        className="mb-0"
        active={tab}
        tabs={TABS.map(t => ({
          id: t.id,
          label: t.label,
          href: t.id === 'feed' ? '/notifications' : `/notifications?tab=${t.id}`,
        }))}
      />
    </div>
    <div className="w-full px-5 py-6 lg:px-8" data-review-scope={`Tab: ${TABS.find(t => t.id === tab)?.label}`}>
      {tab === 'whats-new' ? (
        releases.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <Sparkles className="mx-auto mb-3 h-8 w-8 text-slate-300" strokeWidth={1.75} />
            <p>Nothing new to report just yet</p>
          </div>
        ) : (
          <PhoneRowList className="md:flex md:flex-col md:gap-3">
            {releases.map(r => {
              const inner = (
                <CardBody className="px-4 py-3 md:pb-4 md:pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">{r.title}</p>
                    <span className="flex-shrink-0 text-xs text-slate-400">
                      {formatDate(r.sentAt ?? r.createdAt)}
                    </span>
                  </div>
                  {/* Announcements are authored as rich text, so they render
                      through the shared sanitizing renderer — never raw HTML. */}
                  <div className="mt-1 text-sm text-slate-600">
                    <RichText html={r.body} />
                  </div>
                </CardBody>
              )
              const flat = 'rounded-none border-0 shadow-none md:rounded-2xl md:border md:shadow-sm'
              return r.link ? (
                <Link key={r.id} href={r.link} className="block">
                  <Card className={`transition-colors hover:bg-slate-50 ${flat}`}>{inner}</Card>
                </Link>
              ) : (
                <Card key={r.id} className={flat}>{inner}</Card>
              )
            })}
          </PhoneRowList>
        )
      ) : notifications.length === 0 ? (
        <div className="py-12 text-center text-slate-400">
          {/* A line icon, not an emoji. Every other empty state in the app
              draws one; an emoji renders in the reader's own font and is the
              one piece of type here nobody chose. */}
          <Bell className="mx-auto mb-3 h-8 w-8 text-slate-300" strokeWidth={1.75} />
          <p>No notifications yet</p>
        </div>
      ) : (
        <PhoneRowList className="md:flex md:flex-col md:gap-3">
          {notifications.map((n) => {
            const Icon = iconForNotification(n.type)
            const inner = (
              <CardBody className="px-4 py-3 md:pt-4 md:pb-4">
                <div className="flex items-start gap-3">
                  {/* A plain line icon. It was a tinted rounded chip in the
                      trainer's accent — the tell AGENTS.md names first, and
                      fifty of them down a feed is fifty coloured squares. */}
                  <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 text-sm">{n.title}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{n.body}</p>
                  </div>
                  <span className="text-xs text-slate-400 flex-shrink-0">{formatDate(n.createdAt)}</span>
                </div>
              </CardBody>
            )
            // Phone: rows in one block; desktop keeps the cards.
            const flat = 'rounded-none border-0 shadow-none md:rounded-2xl md:border md:shadow-sm'
            // A notification with a deep link taps through to what it's about.
            return n.link ? (
              <Link key={n.id} href={n.link} className="block">
                <Card className={`transition-colors hover:bg-slate-50 ${flat} ${n.readAt ? 'opacity-60' : ''}`}>{inner}</Card>
              </Link>
            ) : (
              <Card key={n.id} className={`${flat} ${n.readAt ? 'opacity-60' : ''}`}>{inner}</Card>
            )
          })}
        </PhoneRowList>
      )}
    </div>
    </>
  )
}
