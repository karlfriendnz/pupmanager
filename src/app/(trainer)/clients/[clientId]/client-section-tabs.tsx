'use client'

import { PageTabs } from '@/components/shared/page-tabs'
import { CLIENT_SECTIONS, type ClientSection } from './client-profile-types'

/**
 * A client's sections as a tab strip — DESKTOP ONLY.
 *
 * Karl, 2026-08-07: "make the client page have the same tab view as the
 * sessions etc for desktop." So a client reads like an offering does: one strip
 * across the top, and the section you're on is underlined.
 *
 * LINKS, not buttons: each section is genuinely its own server-rendered page
 * (that was the point of splitting them up), so the URL is shareable, a
 * middle-click opens one in a tab, and there is no second copy of any section's
 * content to keep in step with the first.
 *
 * PHONE keeps the profile's tiles. Ten tabs do not fit a 390px row, and a tile
 * carries a line of state — "$116.00 owing", "No practice logged" — that a tab
 * cannot. The two are different jobs at different widths, not one component
 * with a mode.
 *
 * The gating lives HERE rather than at each call site, so the strip can't offer
 * a tab whose page would 404: no Invoices without billing permission, no
 * Achievements without the add-on, no Comms without a channel to talk on.
 */
const LABELS: Record<ClientSection, string> = {
  sessions: 'Sessions',
  training: 'Training log',
  dogs: 'Dogs',
  products: 'Products',
  communication: 'Comms',
  notes: 'Notes',
  invoices: 'Invoices',
  achievements: 'Achievements',
  details: 'Details',
}

export function ClientSectionTabs({
  clientId,
  active,
  canViewBilling,
  showAchievements,
  showComms,
  className,
}: {
  clientId: string
  /** 'overview' is the profile itself — the first tab. */
  active: ClientSection | 'overview'
  canViewBilling: boolean
  showAchievements: boolean
  showComms: boolean
  className?: string
}) {
  const visible = CLIENT_SECTIONS.filter(s =>
    s === 'invoices' ? canViewBilling
    : s === 'achievements' ? showAchievements
    : s === 'communication' ? showComms
    : true,
  )

  return (
    // Full width of the page (Karl: "tabs can be full width of page"). Both
    // screens that draw this sit in a `p-4 md:p-8` container, so the negative
    // margins take the strip out to its edges and the matching padding keeps
    // the tab text in line with the content below — otherwise the hairline
    // stops short on both sides and the strip reads as a floating box rather
    // than the top of the page.
    <div className={`-mx-4 hidden px-4 md:-mx-8 md:block md:px-8 ${className ?? ''}`}>
      <PageTabs
        label="Client sections"
        active={active}
        tabs={[
          { id: 'overview', label: 'Overview', href: `/clients/${clientId}` },
          ...visible.map(s => ({ id: s, label: LABELS[s], href: `/clients/${clientId}/${s}` })),
        ]}
      />
    </div>
  )
}
