import { describe, it, expect } from 'vitest'
import { accessibleSessionWhere } from '@/lib/session-access'
import type { TrainerContext } from '@/lib/membership'

function ctx(partial: Partial<TrainerContext>): TrainerContext {
  return { userId: 'u', companyId: 'co', membershipId: 'm1', role: 'STAFF', permissions: {}, ...partial } as TrainerContext
}

describe('accessibleSessionWhere — restricted-staff session scoping', () => {
  it('OWNER sees everything (empty fragment)', () => {
    expect(accessibleSessionWhere(ctx({ role: 'OWNER' }))).toEqual({})
  })

  it('a member with schedule.viewAll override sees everything', () => {
    expect(accessibleSessionWhere(ctx({ role: 'STAFF', permissions: { 'schedule.viewAll': true } }))).toEqual({})
  })

  it('restricted STAFF is limited to their assigned sessions + class sessions', () => {
    const frag = accessibleSessionWhere(ctx({ role: 'STAFF', membershipId: 'm1', permissions: {} }))
    expect(frag).toEqual({ OR: [{ assignedMembershipId: 'm1' }, { classRunId: { not: null } }] })
  })

  it('the restricted fragment does NOT match an arbitrary other member\'s sessions', () => {
    const frag = accessibleSessionWhere(ctx({ role: 'STAFF', membershipId: 'm1' })) as { OR: Array<{ assignedMembershipId?: string }> }
    expect(frag.OR[0].assignedMembershipId).toBe('m1')
    expect(frag.OR[0].assignedMembershipId).not.toBe('m2')
  })
})
