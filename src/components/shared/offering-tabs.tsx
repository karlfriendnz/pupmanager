'use client'

import type { LucideIcon } from 'lucide-react'
import { PageTabs } from './page-tabs'

/**
 * The tab strip on a detail screen — a class run, a one-off event, a 1:1
 * session package, a product, a client.
 *
 * It used to draw its OWN look: a grey rounded track with white pills, icon
 * over label on a phone, icon beside label from sm up. That made two tab
 * designs in one app — this one on ten screens, and a flat underline on To do,
 * Messages and Alerts — which is what Karl called out on 2026-08-07 ("there
 * should be consistency"). Asked which should win, he picked the underline, so
 * this now renders PageTabs and every screen using it changed at once.
 *
 * The component stays rather than being deleted at ten call sites: its generic
 * `T` keeps each screen's tab ids type-safe (`OfferingTab<'details' | 'options'>`),
 * which a plain string API would lose.
 *
 * What carried over, because both were load-bearing:
 *   • role="tab" + aria-selected, which the specs reach for. aria-current would
 *     be wrong — that says "this is the page you're on in a set of LINKS", and
 *     these switch a panel in place.
 *   • the active tab scrolling into view (now in PageTabs). A strip that
 *     scrolls but opens with the current tab off-screen reads as broken.
 */

export type OfferingTab<T extends string> = {
  id: T
  label: string
  icon: LucideIcon
  /** Count shown on the tab, e.g. how many clients are enrolled. */
  badge?: number
}

export function OfferingTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  label,
}: {
  tabs: OfferingTab<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
  /** Names the tablist for a screen reader, e.g. "Package sections". */
  label?: string
}) {
  return (
    <PageTabs
      label={label ?? 'Sections'}
      className={className ?? 'mb-6'}
      active={value}
      onSelect={id => onChange(id as T)}
      tabs={tabs.map(t => ({ id: t.id, label: t.label, icon: t.icon, count: t.badge }))}
    />
  )
}
