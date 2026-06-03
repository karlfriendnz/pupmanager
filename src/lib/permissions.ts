// Permission catalogue + role presets for multi-trainer businesses.
//
// A member's effective permissions = the role's default map, with their
// per-member overrides (TrainerMembership.permissions JSON) layered on top.
// OWNER always has everything and ignores overrides. The owner picks a role
// (which seeds the checkboxes) then ticks/unticks individual permissions.
//
// Two kinds of permission, enforced differently:
//  • Data-scope toggles (`*.viewAll`) decide whether the member sees the whole
//    business's data or only what's assigned to them — enforced in query
//    scoping helpers (see scopeForMember in this file).
//  • Capability toggles gate an action and are checked once at the relevant
//    route / server action via `can()` / `requirePermission()`.

import type { CompanyRole } from '@/generated/prisma'

export type PermissionKey =
  // data scope
  | 'clients.viewAll'
  | 'schedule.viewAll'
  // capabilities
  | 'clients.edit'
  | 'clients.invite'
  | 'schedule.manage'
  | 'packages.manage'
  | 'classes.manage'
  | 'products.manage'
  | 'forms.manage'
  | 'achievements.manage'
  | 'ai.use'
  | 'enquiries.manage'
  | 'messages.send'
  | 'settings.edit'
  | 'team.manage'
  | 'billing.view'
  | 'billing.seats'

export type PermissionMap = Partial<Record<PermissionKey, boolean>>

// UI metadata — drives the checkbox editor in Settings → Team. `group` buckets
// the rows; `scope: true` marks the "what can they see" toggles so the editor
// can render them in their own section.
export interface PermissionDef {
  key: PermissionKey
  label: string
  description: string
  group: 'Visibility' | 'Clients' | 'Scheduling' | 'Catalogue' | 'Communication' | 'Business'
  scope?: boolean
}

export const PERMISSION_CATALOGUE: PermissionDef[] = [
  { key: 'clients.viewAll', label: 'See all clients', description: 'Otherwise only clients assigned to them.', group: 'Visibility', scope: true },
  { key: 'schedule.viewAll', label: 'See the whole schedule', description: 'Otherwise only their own assigned sessions.', group: 'Visibility', scope: true },

  { key: 'clients.edit', label: 'Add & edit clients', description: 'Create clients and edit profiles, dogs, notes.', group: 'Clients' },
  { key: 'clients.invite', label: 'Invite clients', description: 'Send client invites and re-invites.', group: 'Clients' },

  { key: 'schedule.manage', label: 'Manage the schedule', description: 'Create, edit, reschedule and delete sessions.', group: 'Scheduling' },
  { key: 'classes.manage', label: 'Manage group classes', description: 'Create class runs and manage enrolments.', group: 'Scheduling' },

  { key: 'packages.manage', label: 'Manage packages', description: 'Create and edit training packages.', group: 'Catalogue' },
  { key: 'products.manage', label: 'Manage products', description: 'Create and edit shop products.', group: 'Catalogue' },
  { key: 'forms.manage', label: 'Manage forms & library', description: 'Edit session forms, templates and the training library.', group: 'Catalogue' },
  { key: 'ai.use', label: 'Use AI tools', description: 'Generate training plans and progress summaries with AI.', group: 'Catalogue' },

  { key: 'achievements.manage', label: 'Manage achievements', description: 'Create achievements and award them to clients.', group: 'Clients' },

  { key: 'enquiries.manage', label: 'Handle enquiries', description: 'View, reply to and accept incoming enquiries.', group: 'Communication' },
  { key: 'messages.send', label: 'Message clients', description: 'Send and read client messages.', group: 'Communication' },

  { key: 'settings.edit', label: 'Edit business settings', description: 'Business profile, availability, branding.', group: 'Business' },
  { key: 'team.manage', label: 'Manage the team', description: 'Invite trainers, set roles and permissions.', group: 'Business' },
  { key: 'billing.view', label: 'View billing', description: 'See the subscription and billing pages.', group: 'Business' },
  { key: 'billing.seats', label: 'Add seats', description: 'Add paid trainer seats to the subscription (charges the card on file).', group: 'Business' },
]

const ALL_KEYS = PERMISSION_CATALOGUE.map((p) => p.key)

// Role presets. OWNER is handled specially in `can()` (always true) so its map
// here is just for completeness / UI seeding.
export const ROLE_DEFAULTS: Record<CompanyRole, PermissionMap> = {
  OWNER: Object.fromEntries(ALL_KEYS.map((k) => [k, true])) as PermissionMap,

  // Full operational access; billing + team management stay off by default
  // (owner-only) but are tickable.
  MANAGER: {
    'clients.viewAll': true,
    'schedule.viewAll': true,
    'clients.edit': true,
    'clients.invite': true,
    'schedule.manage': true,
    'classes.manage': true,
    'packages.manage': true,
    'products.manage': true,
    'forms.manage': true,
    'achievements.manage': true,
    'ai.use': true,
    'enquiries.manage': true,
    'messages.send': true,
    'settings.edit': true,
    'team.manage': false,
    'billing.view': false,
    'billing.seats': false,
  },

  // Sees and manages only their own assigned clients/sessions; can message.
  STAFF: {
    'clients.viewAll': false,
    'schedule.viewAll': false,
    'clients.edit': true,
    'clients.invite': false,
    'schedule.manage': true,
    'classes.manage': false,
    'packages.manage': false,
    'products.manage': false,
    'forms.manage': false,
    'achievements.manage': false,
    'ai.use': false,
    'enquiries.manage': false,
    'messages.send': true,
    'settings.edit': false,
    'team.manage': false,
    'billing.view': false,
    'billing.seats': false,
  },
}

/**
 * Effective permission map for a member: role defaults with per-member
 * overrides applied. OWNER resolves to all-true.
 */
export function resolvePermissions(role: CompanyRole, overrides: PermissionMap | null | undefined): Record<PermissionKey, boolean> {
  const base = role === 'OWNER' ? ROLE_DEFAULTS.OWNER : ROLE_DEFAULTS[role]
  const merged = {} as Record<PermissionKey, boolean>
  for (const key of ALL_KEYS) {
    if (role === 'OWNER') {
      merged[key] = true
      continue
    }
    const override = overrides?.[key]
    merged[key] = typeof override === 'boolean' ? override : base[key] ?? false
  }
  return merged
}

/**
 * Does this member hold `permission`? OWNER always passes.
 * `overrides` is the raw TrainerMembership.permissions JSON.
 */
export function can(permission: PermissionKey, role: CompanyRole, overrides?: PermissionMap | null): boolean {
  if (role === 'OWNER') return true
  return resolvePermissions(role, overrides)[permission]
}

/** Coerce the loosely-typed JSON column into a PermissionMap. */
export function asPermissionMap(json: unknown): PermissionMap {
  if (!json || typeof json !== 'object') return {}
  const out: PermissionMap = {}
  for (const key of ALL_KEYS) {
    const v = (json as Record<string, unknown>)[key]
    if (typeof v === 'boolean') out[key] = v
  }
  return out
}
