/**
 * The outside services PupManager talks to, as one list.
 *
 * These used to be four unrelated rows in the Settings menu — Calendar, Xero,
 * Payments, Connect Website — so "what is this connected to?" had no single
 * answer and a trainer had to open each in turn to find out. Karl asked for the
 * Add-ons layout instead (2026-07-30): a card each, saying what it does and
 * whether it's live, with Manage leading to that one's own settings.
 *
 * Deliberately NOT the add-on catalogue. An add-on is something you switch on and
 * pay for; an integration is something you connect, which can be switched on and
 * still not working — the whole reason this screen exists.
 */

/** Where an integration stands, in the order a trainer cares about. */
export type IntegrationState =
  /** Connected and doing its job. */
  | 'connected'
  /** Switched on, but nothing is connected yet — the state that used to hide. */
  | 'needs_setup'
  /** Available, not switched on. */
  | 'off'

export interface IntegrationDef {
  id: string
  name: string
  blurb: string
  /** The Settings tab holding this one's own setup. */
  manageHref: string
  /** The add-on that gates it, if any. */
  addonId?: string
}

export const INTEGRATIONS: readonly IntegrationDef[] = [
  {
    id: 'googlecalendar',
    name: 'Google Calendar',
    blurb:
      'Your sessions, classes and availability appear in your own Google Calendar, and anything already in it shows up on your schedule so you never get double-booked. Each staff member connects their own calendar.',
    manageHref: '/settings?tab=calendar',
    addonId: 'googlecalendar',
  },
  {
    id: 'stripe',
    name: 'Card payments',
    blurb:
      'Take card payments from clients for sessions, courses and products. Money lands in your own bank account — PupManager never holds it.',
    manageHref: '/settings?tab=payments',
    addonId: 'payments',
  },
  {
    id: 'xero',
    name: 'Xero',
    blurb:
      'Invoices and payments flow straight into your Xero organisation, coded to the accounts you choose. Stops you typing the same figures twice at month end.',
    manageHref: '/settings?tab=xero',
    addonId: 'xero',
  },
  {
    id: 'website',
    name: 'Your website',
    blurb:
      'Put your booking page, enquiry forms and class list on your own site — a snippet to paste, or a link to send. Enquiries arrive in PupManager.',
    manageHref: '/settings?tab=integration',
  },
]

/** What the card says about where this one stands. */
export function stateLabel(state: IntegrationState): string {
  switch (state) {
    case 'connected': return 'Connected'
    // Said as the next action, not as a fault: being switched on without being
    // connected is normal for a minute, and "Not connected" reads like a problem.
    case 'needs_setup': return 'Finish connecting'
    case 'off': return 'Not set up'
  }
}

/**
 * Resolve a card's state from the two facts that matter: is it switched on, and
 * is something actually connected?
 *
 * `connected` is only ever asked about an integration that is ON, so an
 * integration nobody has enabled reads as "Not set up" rather than as broken.
 */
export function integrationState(enabled: boolean, connected: boolean): IntegrationState {
  if (!enabled) return 'off'
  return connected ? 'connected' : 'needs_setup'
}
