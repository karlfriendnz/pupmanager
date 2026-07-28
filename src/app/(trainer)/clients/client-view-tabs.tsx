'use client'

import { GraduationCap, History, UserPlus2, Archive } from 'lucide-react'
import { OfferingTabs } from '@/components/shared/offering-tabs'
import type { ClientView } from '@/lib/client-activity'

/**
 * The clients list's tab strip.
 *
 * This exists to hold the ICONS. OfferingTabs takes a LucideIcon per tab, and a
 * Lucide icon is a function — the clients page is a SERVER component, and a
 * function cannot cross the server/client boundary ("Only plain objects can be
 * passed to Client Components"). The offering screens hit no such problem
 * because they are client components already and pick their own icons inline.
 *
 * So the page passes plain data — id, label, count, href — and the icons are
 * chosen here, on the client side of the line.
 */
const ICON = {
  current: GraduationCap,
  past: History,
  never: UserPlus2,
  archived: Archive,
} as const

export function ClientViewTabs({
  tabs,
  value,
  className,
}: {
  tabs: { id: ClientView; label: string; badge?: number; href: string }[]
  value: ClientView
  className?: string
}) {
  return (
    <OfferingTabs
      tabs={tabs.map(t => ({ ...t, icon: ICON[t.id] }))}
      value={value}
      className={className}
    />
  )
}
