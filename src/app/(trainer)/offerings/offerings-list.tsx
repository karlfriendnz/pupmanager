'use client'

import {
  Package, GraduationCap, Ticket, CalendarPlus, Dog, ShoppingBag, Layers, Tag,
  type LucideIcon,
} from 'lucide-react'
import { FlatBlock, FlatRow } from '@/components/shared/flat-list'

/**
 * The Offerings hub list.
 *
 * This exists as its own client component for one reason: FlatRow takes an icon
 * COMPONENT, and a lucide icon can't cross the server→client boundary — React
 * only passes plain data, and a function component isn't that ("Only plain
 * objects can be passed to Client Components"). The page used to hand FlatRow
 * its icons directly and 500'd on render. So the page sends a plain key and the
 * icons are picked here, on the client side of the line.
 */
const ICONS = {
  packages: Package,
  classes: GraduationCap,
  casual: Ticket,
  events: CalendarPlus,
  daycare: Dog,
  memberships: Ticket,
  products: ShoppingBag,
  library: Layers,
  tags: Tag,
} satisfies Record<string, LucideIcon>

export type OfferingRowData = {
  href: string
  label: string
  sub: string
  icon: keyof typeof ICONS
}

export function OfferingsList({ rows }: { rows: OfferingRowData[] }) {
  return (
    <FlatBlock>
      {rows.map(r => (
        <FlatRow key={r.href} href={r.href} icon={ICONS[r.icon]} label={r.label} sub={r.sub} />
      ))}
    </FlatBlock>
  )
}
