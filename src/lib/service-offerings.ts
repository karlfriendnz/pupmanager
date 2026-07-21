// Maps a business's onboarding personas (TrainerProfile.businessRoles) to the
// set of things they can add to their schedule. A groomer or pet sitter only
// does 1:1 appointments; a dog walker adds group walks; only trainers and
// behaviourists run classes / drop-in classes.
//
// Kept as pure data + a function so it can be unit-tested and shared between the
// schedule page (server) and the slot chooser (client).

// Mirrors SlotAddType in schedule/slot-type-chooser.tsx. Same string-literal
// union, so values are mutually assignable without importing the client module.
export type ServiceSlotType = 'session' | 'class' | 'buddies' | 'dropin'

// Canonical display order — filtered lists preserve this ordering.
const ALL_SLOT_TYPES: ServiceSlotType[] = ['session', 'class', 'buddies', 'dropin']

// Which add-options each persona unlocks. 'session' (a 1:1 booking) is available
// to everyone. Personas not listed here contribute nothing extra.
const ROLE_SLOT_TYPES: Record<string, ServiceSlotType[]> = {
  trainer: ['session', 'class', 'dropin'],
  behaviourist: ['session', 'class', 'dropin'],
  puppyschool: ['session', 'class', 'dropin'],
  walker: ['session', 'buddies'],
  groomer: ['session'],
  petsitter: ['session'],
  // 'other' intentionally unlisted → allowedSlotTypes falls back to everything.
}

/**
 * The schedule "add" options a business should see, given its personas.
 * - No/empty roles → everything (unknown business, or a legacy account that
 *   predates persona capture — never hide options we're unsure about).
 * - Unrecognised roles only → everything (forward-compatible: a new persona
 *   we don't have a mapping for yet shouldn't silently lose options).
 * - Otherwise → the union of the matched personas' options, in canonical order.
 */
export function allowedSlotTypes(roles: string[] | null | undefined): ServiceSlotType[] {
  if (!roles || roles.length === 0) return [...ALL_SLOT_TYPES]
  const set = new Set<ServiceSlotType>()
  let matchedAny = false
  for (const role of roles) {
    const types = ROLE_SLOT_TYPES[role]
    if (types) {
      matchedAny = true
      for (const t of types) set.add(t)
    }
  }
  if (!matchedAny) return [...ALL_SLOT_TYPES]
  return ALL_SLOT_TYPES.filter((t) => set.has(t))
}
