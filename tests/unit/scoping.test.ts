import { describe, it, expect } from 'vitest'
// The data-isolation decision ("can this member see the whole business, or only
// their own rows?") lives in the pure permissions core. scopeForMember() is a
// thin wrapper that turns `can(viewAll) === false` into a `{ assignedMembershipId }`
// filter — testing `can`/`resolvePermissions` covers the security-critical part
// without dragging in the auth/next-server imports membership.ts carries.
import { can, resolvePermissions } from '../../src/lib/permissions'

describe('permission resolution — tenant/member data isolation', () => {
  it('OWNER can do everything (incl. view-all and billing)', () => {
    expect(can('clients.viewAll', 'OWNER', null)).toBe(true)
    expect(can('schedule.viewAll', 'OWNER', null)).toBe(true)
    expect(can('billing.seats', 'OWNER', null)).toBe(true)
  })

  it('STAFF cannot view all clients or schedule by default (restricted to own)', () => {
    expect(can('clients.viewAll', 'STAFF', null)).toBe(false)
    expect(can('schedule.viewAll', 'STAFF', null)).toBe(false)
  })

  it('STAFF can be granted view-all via an explicit per-member override', () => {
    expect(can('clients.viewAll', 'STAFF', { 'clients.viewAll': true })).toBe(true)
  })

  it('an override does not bleed across permissions', () => {
    const overrides = { 'clients.viewAll': true }
    expect(can('clients.viewAll', 'STAFF', overrides)).toBe(true)
    // schedule was NOT overridden, so it stays at the STAFF default (false).
    expect(can('schedule.viewAll', 'STAFF', overrides)).toBe(false)
  })

  it('STAFF keeps sensible defaults — can edit clients, cannot see billing', () => {
    const p = resolvePermissions('STAFF', null)
    expect(p['clients.edit']).toBe(true)
    expect(p['billing.view']).toBe(false)
    expect(p['team.manage']).toBe(false)
  })
})
