import { describe, it, expect, vi, beforeEach } from 'vitest'

// findOrJoinClient — the shared "person fills in their email → land as a client
// of this trainer" helper. The contract under test:
//   (a) new email           → create User + ClientProfile (+ dogs)
//   (b) existing User WITH a profile for this trainer → JOIN (no new User, no
//       new profile, dog added, contact fields only backfilled when null)
//   (c) existing User WITHOUT a profile for this trainer → reuse User, new profile
//   (d) placeholder emails are the caller's job — the helper never sees them, so
//       we assert it deduped on the exact email it was handed (no normalisation)
//
// We don't mock '@/lib/prisma' because the helper takes a `tx` argument; we hand
// it a hand-rolled fake transaction client and assert on the calls it makes.

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { findOrJoinClient } from '@/lib/client-upsert'

// A minimal fake of the bits of Prisma's TransactionClient the helper touches.
function makeTx(opts: {
  existingUser?: { id: string } | null
  existingProfile?: { id: string; dogId: string | null; phone: string | null; addressLine: string | null } | null
  upsertUserId?: string
} = {}) {
  let dogSeq = 0
  const calls = {
    userFindUnique: vi.fn().mockResolvedValue(opts.existingUser ?? null),
    userUpsert: vi.fn().mockResolvedValue({ id: opts.upsertUserId ?? opts.existingUser?.id ?? 'new-user' }),
    dogCreate: vi.fn().mockImplementation(async () => ({ id: `dog-${++dogSeq}` })),
    profileFindUnique: vi.fn().mockResolvedValue(opts.existingProfile ?? null),
    profileCreate: vi.fn().mockResolvedValue({ id: 'new-profile' }),
    profileUpdate: vi.fn().mockResolvedValue({}),
  }
  const tx = {
    user: { findUnique: calls.userFindUnique, upsert: calls.userUpsert },
    dog: { create: calls.dogCreate },
    clientProfile: { findUnique: calls.profileFindUnique, create: calls.profileCreate, update: calls.profileUpdate },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { tx: tx as any, calls }
}

beforeEach(() => vi.clearAllMocks())

describe('findOrJoinClient — (a) brand-new email', () => {
  it('creates the User and a ClientProfile, with dogs', async () => {
    const { tx, calls } = makeTx({ existingUser: null, existingProfile: null, upsertUserId: 'u-new' })
    const res = await findOrJoinClient(tx, {
      email: 'new@person.test',
      trainerId: 't1',
      name: 'Sarah',
      phone: '021',
      dogs: [{ name: 'Bailey' }, { name: 'Max' }],
    })
    expect(res.joined).toBe(false)
    expect(res.createdUser).toBe(true)
    expect(res.userId).toBe('u-new')
    expect(res.clientProfileId).toBe('new-profile')
    expect(res.createdDogIds).toHaveLength(2)
    expect(calls.profileCreate).toHaveBeenCalledTimes(1)
    // First dog becomes the primary; the rest connect via the dogs relation.
    const data = calls.profileCreate.mock.calls[0][0].data
    expect(data.dogId).toBe('dog-1')
    expect(data.dogs.connect).toEqual([{ id: 'dog-2' }])
    expect(data.trainerId).toBe('t1')
  })
})

describe('findOrJoinClient — (b) existing User WITH a profile for this trainer', () => {
  it('JOINs: no new User, no new profile, the dog is added to the existing profile', async () => {
    const { tx, calls } = makeTx({
      existingUser: { id: 'u-1' },
      existingProfile: { id: 'p-1', dogId: 'existing-dog', phone: '999', addressLine: '1 St' },
    })
    const res = await findOrJoinClient(tx, {
      email: 'returning@person.test',
      trainerId: 't1',
      name: 'Sarah',
      phone: 'IGNORED', // profile already has a phone → must NOT clobber
      dogs: [{ name: 'Rex' }],
    })
    expect(res.joined).toBe(true)
    expect(res.createdUser).toBe(false)
    expect(res.userId).toBe('u-1')
    expect(res.clientProfileId).toBe('p-1')
    expect(calls.profileCreate).not.toHaveBeenCalled()
    // Dog created and attached to the existing profile.
    expect(calls.dogCreate).toHaveBeenCalledTimes(1)
    expect(calls.dogCreate.mock.calls[0][0].data.clientProfileId).toBe('p-1')
    // Profile already had a primary dog + phone + address → update must NOT touch them.
    if (calls.profileUpdate.mock.calls.length > 0) {
      const upd = calls.profileUpdate.mock.calls[0][0].data
      expect(upd.dog).toBeUndefined()
      expect(upd.phone).toBeUndefined()
      expect(upd.addressLine).toBeUndefined()
    }
  })

  it('JOIN sets the primary dog only when the profile had none, and backfills null contact fields', async () => {
    const { tx, calls } = makeTx({
      existingUser: { id: 'u-1' },
      existingProfile: { id: 'p-1', dogId: null, phone: null, addressLine: null },
    })
    await findOrJoinClient(tx, {
      email: 'returning@person.test',
      trainerId: 't1',
      name: 'Sarah',
      phone: '021555',
      address: { line: '12 Bark Ave' },
      dogs: [{ name: 'Rex' }],
    })
    expect(calls.profileUpdate).toHaveBeenCalledTimes(1)
    const upd = calls.profileUpdate.mock.calls[0][0].data
    expect(upd.dog.connect.id).toBe('dog-1') // first new dog becomes primary
    expect(upd.phone).toBe('021555')
    expect(upd.addressLine).toBe('12 Bark Ave')
  })

  it('JOIN with no new dog still succeeds and never removes existing dogs', async () => {
    const { tx, calls } = makeTx({
      existingUser: { id: 'u-1' },
      existingProfile: { id: 'p-1', dogId: 'd0', phone: '1', addressLine: 'a' },
    })
    const res = await findOrJoinClient(tx, { email: 'x@y.test', trainerId: 't1', name: 'Sarah', dogs: [] })
    expect(res.joined).toBe(true)
    expect(res.createdDogIds).toEqual([])
    expect(calls.dogCreate).not.toHaveBeenCalled()
    // Nothing to update (had primary, phone, address) → no clobbering update.
    expect(calls.profileUpdate).not.toHaveBeenCalled()
  })
})

describe('findOrJoinClient — (c) existing User WITHOUT a profile for this trainer', () => {
  it('reuses the User and creates a fresh ClientProfile for this trainer', async () => {
    const { tx, calls } = makeTx({
      existingUser: { id: 'u-shared' },
      existingProfile: null, // client of a DIFFERENT trainer (or none) → no profile here
    })
    const res = await findOrJoinClient(tx, {
      email: 'shared@person.test',
      trainerId: 't2',
      name: 'Sarah',
      dogs: [{ name: 'Bailey' }],
    })
    expect(res.joined).toBe(false)
    expect(res.createdUser).toBe(false) // user already existed → reused, not created
    expect(res.userId).toBe('u-shared')
    expect(calls.userUpsert).toHaveBeenCalledTimes(1) // upsert resolves to the existing user
    expect(calls.profileCreate).toHaveBeenCalledTimes(1)
    expect(calls.profileCreate.mock.calls[0][0].data.trainerId).toBe('t2')
  })
})

describe('findOrJoinClient — (d) exact-email dedupe, no normalisation', () => {
  it('dedupes on the exact email it was handed (caller is responsible for placeholder gating)', async () => {
    const { tx, calls } = makeTx({ existingUser: null, existingProfile: null })
    await findOrJoinClient(tx, { email: '  Trim@Me.test  ', trainerId: 't1', name: 'A' })
    // Trimmed but not lowercased — upsert keys on the trimmed value verbatim.
    expect(calls.userUpsert.mock.calls[0][0].where.email).toBe('Trim@Me.test')
  })
})

describe('findOrJoinClient — concurrency: lost profile-create race', () => {
  it('on a P2002 from create, re-reads the winning profile and joins it', async () => {
    const { tx, calls } = makeTx({ existingUser: { id: 'u-1' }, existingProfile: null })
    // First findUnique (pre-create) → null; create loses the race; second
    // findUnique (post-P2002) → the winner.
    calls.profileFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'race-winner', dogId: 'd', phone: 'p', addressLine: 'a' })
    calls.profileCreate.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))

    const res = await findOrJoinClient(tx, { email: 'x@y.test', trainerId: 't1', name: 'A', dogs: [] })
    expect(res.joined).toBe(true)
    expect(res.clientProfileId).toBe('race-winner')
  })
})
