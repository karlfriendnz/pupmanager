// The shapes the client profile and its section pages both speak.
//
// They live apart from either because every section is its own ROUTE now — the
// profile serialises a summary, each section page serialises its own detail,
// and both have to agree on what a session or a comm looks like. A type file
// (no 'use client', no imports) can be pulled into a server page and a client
// component alike.

export interface CommItem {
  id: string
  kind: 'email' | 'message'
  direction: 'inbound' | 'outbound'
  subject: string
  /** Email delivery status (SENT/DELIVERED/OPENED/CLICKED/BOUNCED), or null. */
  status: string | null
  /** ISO. */
  date: string
}

export interface Dog {
  id: string
  name: string
  breed: string | null
  weight: number | null
  dob: string | null   // pre-serialised ISO string
  notes: string | null
  // Set when the dog has died. Deceased dogs stay VISIBLE on the Dog page — the
  // owner's history is theirs to keep — and are excluded only from
  // forward-looking surfaces (invites, rosters, attendance, reminders).
  deceasedAt: string | null   // pre-serialised ISO string
}

export type SessionStatus = 'UPCOMING' | 'COMPLETED' | 'COMMENTED' | 'INVOICED'

export const STATUS_OPTIONS: { value: SessionStatus; label: string; colour: string }[] = [
  { value: 'UPCOMING',  label: 'Upcoming',  colour: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'COMPLETED', label: 'Completed', colour: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'COMMENTED', label: 'Commented', colour: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'INVOICED',  label: 'Invoiced',  colour: 'bg-purple-100 text-purple-700 border-purple-200' },
]

export interface TrainingSession {
  id: string
  title: string
  scheduledAt: string   // ISO string
  durationMins: number
  sessionType: string
  status: SessionStatus
  invoicedAt: string | null
  location: string | null
  virtualLink: string | null
  description: string | null
  dogName: string | null
}

export interface CustomField {
  id: string
  label: string
  appliesTo: 'OWNER' | 'DOG'
  category: string | null
}

export interface ShopProduct {
  id: string
  name: string
  kind: 'PHYSICAL' | 'DIGITAL'
  priceCents: number | null
  salePriceCents?: number | null
  imageUrl: string | null
  category: string | null
  /** Whether the product is visible in the client's own shop. The trainer can
   *  still add a hidden product to a client; the picker badges it so they know. */
  active: boolean
  /**
   * Sizes/colours. Empty = the product is added in one tap. With any, the row
   * opens into them — a client can't be handed "a harness".
   */
  variants?: { id: string; name: string; priceCents: number | null; salePriceCents: number | null; stockCount: number | null }[]
}

export interface PendingProductRequest {
  id: string
  note: string | null
  /** How many. Always at least 1 — the column is NOT NULL DEFAULT 1, so a row
   *  written before quantities existed reads back as the one it always was. */
  quantity: number
  /** Which one was ordered, when the product has options. */
  variant?: { id: string; name: string } | null
  product: { id: string; name: string; kind: 'PHYSICAL' | 'DIGITAL'; imageUrl: string | null }
}

/** A request the trainer has already handed over, for the Products page's
 *  second list. Same row, later in its life — FULFILLED rather than PENDING. */
export interface HandedOverRequest extends PendingProductRequest {
  /** When it was handed over — pre-serialised ISO. */
  fulfilledAt: string | null
}

export interface ClientContact {
  email: string | null
  phone: string | null
  clientSince: string
  address: string | null
  distanceFromBase: string | null
}

/** Every section of a client that has its own page. */
export const CLIENT_SECTIONS = [
  'sessions', 'training', 'dogs', 'products', 'communication', 'notes', 'invoices', 'achievements', 'details',
] as const
export type ClientSection = typeof CLIENT_SECTIONS[number]

export function isClientSection(v: string): v is ClientSection {
  return (CLIENT_SECTIONS as readonly string[]).includes(v)
}

/**
 * The old `?tab=` deep links, mapped onto the routes that replaced them.
 *
 * They are in bookmarks, in emails and in this app's own screens (the assign
 * modal, the session screen's Back), so the profile redirects rather than
 * ignoring them. `overview` is deliberately absent — the profile IS the
 * overview now, so that one lands where it always did.
 */
export const LEGACY_TAB_TO_SECTION: Record<string, ClientSection> = {
  products: 'products',
  sessions: 'sessions',
  training: 'training',
  dogs: 'dogs',
  communication: 'communication',
  comms: 'communication',
  notes: 'notes',
  invoices: 'invoices',
  achievements: 'achievements',
  details: 'details',
}
