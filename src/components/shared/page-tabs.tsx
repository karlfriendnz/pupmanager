'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The tab strip, for every screen that has one.
 *
 * Karl, 2026-08-07: "there is a difference in design from todo / messages /
 * alerts — the tabs look different, the headers look different, there should be
 * consistency." There were three:
 *   • To do    — underline drawn as an absolutely-positioned span, icons, a
 *                plain grey count
 *   • Alerts   — underline drawn as border-b-2 on the link itself, no icons,
 *                no counts, and a different inactive grey
 *   • Messages — blue pills with filled count chips, which also broke the house
 *                rule that colour is the TRAINER's: it was hard-coded blue, not
 *                their accent
 *
 * This is the underline one, because it is the flattest and the only one that
 * carries no decorative colour of its own.
 *
 * Two modes, and they are genuinely different things:
 *   • `href` per tab — real navigation, so real links, and the URL is
 *     shareable. Rendered inside a <nav>. NO role="tab": that would override
 *     the implicit link role and break both assistive tech expectations and
 *     every getByRole('link') in the specs.
 *   • `onSelect` — client-side switching, so buttons in a proper tablist with
 *     role="tab" and aria-selected.
 */
export type PageTab = {
  id: string
  label: string
  /** Present = this tab is a link (navigation). Absent = onSelect is used. */
  href?: string
  /** A total, shown quietly beside the label. 0 and null are not shown. */
  count?: number | null
  /** Needs attention. Shown as a filled badge — the one place colour is loud. */
  unread?: number | null
  icon?: LucideIcon
}

export function PageTabs({
  tabs,
  active,
  onSelect,
  label,
  className,
}: {
  tabs: PageTab[]
  active: string
  onSelect?: (id: string) => void
  /** Names the strip for screen readers, e.g. "To do sections". */
  label: string
  className?: string
}) {
  const asLinks = tabs.some(t => t.href)
  const box = useRef<HTMLElement>(null)

  // Scroll the active tab into view. A strip that scrolls but opens with the
  // current tab off-screen is the version that feels broken — nothing tells you
  // the row moves, and the thing you're looking at isn't on it. (Carried over
  // from OfferingTabs, which this replaced; it matters most on the package
  // builder's five tabs.)
  useEffect(() => {
    const el = box.current
    if (!el || el.scrollWidth <= el.clientWidth) return
    const target = el.querySelector<HTMLElement>('[data-tab-active="true"]')
    if (!target) return
    const b = el.getBoundingClientRect()
    const t = target.getBoundingClientRect()
    el.scrollTo({ left: Math.max(0, el.scrollLeft + (t.left - b.left) - (b.width - t.width) / 2), behavior: 'smooth' })
  }, [active])

  const inner = tabs.map(t => {
    const isActive = t.id === active
    const body = (
      <>
        {/* No icon, on any strip. Half the app's tabs carried one and half
            didn't, which is the "the tab is different to the other tabs"
            Karl kept hitting. Dropping them is the side that also wins on
            merit: the labels are already unambiguous ("Details", "Clients",
            "Active"), so an icon beside them decorates rather than explains —
            and now tabs share the row, a 16px glyph plus its gap is width the
            words could have used. `icon` stays on the type because callers
            pass it; it simply isn't drawn. */}
        {t.label}
        {t.count != null && t.count > 0 && (
          <span className="text-xs tabular-nums text-slate-400">{t.count}</span>
        )}
        {t.unread != null && t.unread > 0 && (
          <span
            aria-label={`${t.unread} unread`}
            className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold tabular-nums text-white"
          >
            {t.unread > 9 ? '9+' : t.unread}
          </span>
        )}
        {/* The underline sits ON the container's hairline rather than replacing
            it, so the row's baseline never shifts as tabs change. */}
        {isActive && <span className="absolute -bottom-px left-3 right-3 h-0.5 rounded-full bg-accent" />}
      </>
    )

    // Tabs SHARE the row rather than hugging the left edge (Karl) — but a tab
    // never gets narrower than its own label.
    //
    // `grow shrink-0` on an auto basis, NOT flex-1. flex-1 is `1 1 0%`: every
    // tab takes an equal share whatever it says, so on a five-tab strip at
    // 390px each got 68px and "Automation" was cut off inside its own box
    // (measured — that's the "tabs are not quite right" on the class run). A
    // min-width floor didn't save it either, because equal shares are computed
    // from a zero basis.
    //
    // Growing from the content width means: spare room is shared out, and when
    // there isn't any the labels stay whole and the row scrolls instead.
    const cls = cn(
      'relative flex grow shrink-0 items-center justify-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 md:grow-0 md:justify-start',
      isActive ? 'text-accent' : 'text-slate-500 hover:text-slate-700',
    )

    return t.href ? (
      <Link key={t.id} href={t.href} aria-current={isActive ? 'page' : undefined} data-tab-active={isActive} className={cls}>
        {body}
      </Link>
    ) : (
      <button
        key={t.id}
        type="button"
        role="tab"
        aria-selected={isActive}
        data-tab-active={isActive}
        onClick={() => onSelect?.(t.id)}
        className={cls}
      >
        {body}
      </button>
    )
  })

  // Scrolls sideways rather than wrapping to a second row — four tabs and a
  // count don't fit across a 390px phone, and a wrapped tab row reads as a
  // broken grid. no-scrollbar because a rail under the tabs is not a thing.
  // `shrink-0` is load-bearing, not tidiness. A tab strip is very often a
  // child of a flex COLUMN — the session popover's scrollable body is one —
  // and flex children shrink by default. When the panel below it filled up
  // (the session report opening as a full list), this strip was squeezed to
  // 1px: every tab still in the DOM, with its text, and nothing on screen but
  // a hairline. Karl saw empty boxes where the tabs had been.
  const cn_ = cn('flex shrink-0 gap-1 overflow-x-auto no-scrollbar border-b border-slate-200', className)

  return asLinks ? (
    <nav ref={box as React.RefObject<HTMLElement>} aria-label={label} className={cn_}>{inner}</nav>
  ) : (
    <div ref={box as React.RefObject<HTMLDivElement>} role="tablist" aria-label={label} className={cn_}>{inner}</div>
  )
}
