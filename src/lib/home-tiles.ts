// Which buttons a trainer gets on the phone home screen.
//
// The six tiles aren't the same job for everyone: a dog walker lives in a route
// and a calendar, a groomer in an appointment book, a trainer in programmes and
// session notes. The persona is already captured at onboarding
// (TrainerProfile.businessRoles — see PERSONAS in onboarding-recommendations)
// and already decides the landing page, so it drives this too.
//
// Pure data + functions: no Prisma, no React. The caller resolves add-ons and
// permissions and passes the answers in, so this stays unit-testable.
//
// LATER: trainers pick their own. `resolveHomeTiles` already takes `custom` —
// persist an ordered list of TileId per user and pass it here; everything else
// (gating, the six-tile cap, the fallback) keeps working unchanged.

export type TileId =
  | 'schedule'
  | 'clients'
  | 'offerings'
  | 'todo'
  | 'money'
  | 'messages'
  | 'route'
  | 'daycare'
  | 'marketing'
  | 'reports'

/** How many buttons the phone home shows. Two columns, three rows. */
export const HOME_TILE_COUNT = 6

/** What each tile needs before it can be offered. */
type TileGate = {
  /** Add-on id that must be on (getEnabledAddons). */
  addon?: string
  /** Permission the member must hold. */
  permission?: string
}

const TILE_GATES: Partial<Record<TileId, TileGate>> = {
  todo: { addon: 'notes' },
  route: { addon: 'routeplanner' },
  daycare: { addon: 'puppyschool' },
  marketing: { addon: 'marketing' },
  money: { permission: 'billing.view' },
  reports: { permission: 'billing.view' },
}

// Per-persona order of preference. Everyone shares the same first two — the
// day's work and the people it's for — then the trades diverge. Lists are
// longer than six on purpose: whatever is gated off falls away and the next
// one moves up, so nobody ends up with a short grid.
const BY_PERSONA: Record<string, TileId[]> = {
  // Appointment-book trades: the round, then who's on it, then getting paid.
  walker: ['schedule', 'clients', 'route', 'money', 'messages', 'offerings', 'todo', 'marketing'],
  petsitter: ['schedule', 'clients', 'money', 'messages', 'offerings', 'todo', 'marketing'],
  // Groomers asked for less, not more — no notes backlog up front.
  groomer: ['schedule', 'clients', 'offerings', 'money', 'messages', 'marketing', 'todo'],
  // Programme trades: what's booked, who's on it, what they're working through.
  trainer: ['schedule', 'clients', 'offerings', 'todo', 'money', 'messages', 'reports'],
  behaviourist: ['schedule', 'clients', 'todo', 'offerings', 'money', 'messages', 'reports'],
  // Cohorts and day-parts first.
  puppyschool: ['schedule', 'clients', 'daycare', 'offerings', 'todo', 'messages', 'money'],
}

const DEFAULT_ORDER: TileId[] = ['schedule', 'clients', 'offerings', 'todo', 'money', 'messages']

/**
 * The preference order for a set of business roles.
 *
 * A trainer who is also a groomer gets both lists merged in the order they
 * appear, deduped — the first role's priorities lead, the second fills the
 * remaining slots with anything the first didn't ask for.
 */
export function tileOrderForRoles(roles: string[]): TileId[] {
  const lists = roles.map(r => BY_PERSONA[r]).filter(Boolean)
  if (lists.length === 0) return [...DEFAULT_ORDER]

  const merged: TileId[] = []
  // Round-robin rather than concatenate: with two roles, a straight concat
  // would spend all six slots on the first one's list and the second trade
  // would never show up at all.
  const maxLen = Math.max(...lists.map(l => l.length))
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      const id = list[i]
      if (id && !merged.includes(id)) merged.push(id)
    }
  }
  // Anything no persona asked for still backs the list, so gating can never
  // leave the grid short.
  for (const id of DEFAULT_ORDER) if (!merged.includes(id)) merged.push(id)
  return merged
}

/**
 * The tiles to render, in order.
 *
 * @param roles       TrainerProfile.businessRoles
 * @param enabledAddons  add-on ids currently on for the company
 * @param hasPermission  answers permission checks for this member
 * @param custom      trainer's own chosen order (future) — wins outright, but
 *                    is still gated, so a tile they picked before losing the
 *                    add-on doesn't render a dead button
 */
export function resolveHomeTiles({
  roles = [],
  enabledAddons,
  hasPermission = () => true,
  custom = null,
  count = HOME_TILE_COUNT,
}: {
  roles?: string[]
  enabledAddons: Set<string> | ReadonlySet<string>
  hasPermission?: (permission: string) => boolean
  custom?: TileId[] | null
  count?: number
}): TileId[] {
  const allowed = (id: TileId) => {
    const gate = TILE_GATES[id]
    if (!gate) return true
    if (gate.addon && !enabledAddons.has(gate.addon)) return false
    if (gate.permission && !hasPermission(gate.permission)) return false
    return true
  }

  const order = custom && custom.length > 0 ? custom : tileOrderForRoles(roles)
  return order.filter(allowed).slice(0, count)
}
