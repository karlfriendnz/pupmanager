'use client'

import { PageTabs } from '@/components/shared/page-tabs'
import type { ClientView } from '@/lib/client-activity'

/**
 * The clients list's tab strip.
 *
 * It used to be a third design of its own — one bordered block split by
 * hairlines, with the active tab tinted in the trainer's colour — written
 * deliberately rather than reusing OfferingTabs, because OfferingTabs was then
 * the grey pill strip and bending it into this shape needed three flags only
 * this caller would ever set.
 *
 * That reasoning expired on 2026-08-07: Karl asked for one tab design across
 * the platform and picked the underline, so OfferingTabs and PageTabs are the
 * same thing now and there is nothing left to bend. Two honest shapes beat one
 * component with a mode for each; ONE shape beats both.
 *
 * What the old strip taught, and what PageTabs keeps:
 *   • the row splits evenly, so the longest label can't set the width of the
 *     rest — "In class now 18" wrapping onto two lines is what started it;
 *   • every tab is reachable at 390px (it scrolls rather than crushing);
 *   • no count. The number beside a tab is a fact about a list you AREN'T
 *     looking at, and four of them turned the row into an arithmetic problem.
 *     The list itself says how many there are — so `count` is deliberately not
 *     passed, even though PageTabs supports it.
 *
 * Real links, not buttons: each view is its own server render, so the URL is
 * the state and a middle-click opens one in a tab like anything else.
 */
export function ClientViewTabs({
  tabs,
  value,
  className = '',
}: {
  tabs: { id: ClientView; label: string; href: string }[]
  value: ClientView
  className?: string
}) {
  return (
    <PageTabs
      label="Client views"
      className={className}
      active={value}
      tabs={tabs.map(t => ({ id: t.id, label: t.label, href: t.href }))}
    />
  )
}
