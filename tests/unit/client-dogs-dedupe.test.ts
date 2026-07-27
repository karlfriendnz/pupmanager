import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  mergeClientDogs,
  mergeClientDogsFlagged,
  extraClientDogs,
  clientDogCount,
} from '@/lib/dogs'

// Fiona (Mersea Mutts) reported "quite a few of the dogs have duplicated too.
// If I delete one of the dog's records, it deletes both copies." There was
// never a second row: a Dog reaches a client down TWO relations —
// ClientProfile.dogId (primary) and Dog.clientProfileId (household list) — and
// 40 of her dogs travelled both. Every screen that concatenated the two lists
// drew that one dog twice. These tests pin the single deduping helper.

const BAILEY = { id: 'dog-bailey', name: 'Bailey' }
const MILO = { id: 'dog-milo', name: 'Milo' }

describe('mergeClientDogs — the both-relations dog', () => {
  it('renders a dog that is BOTH primary and additional exactly once', () => {
    const merged = mergeClientDogs(BAILEY, [BAILEY])
    expect(merged).toHaveLength(1)
    expect(merged.map(d => d.id)).toEqual(['dog-bailey'])
  })

  it('keeps genuinely different dogs, primary first', () => {
    expect(mergeClientDogs(BAILEY, [MILO]).map(d => d.name)).toEqual(['Bailey', 'Milo'])
  })

  it('dedupes repeats within the additional list alone', () => {
    expect(mergeClientDogs(null, [MILO, MILO]).map(d => d.id)).toEqual(['dog-milo'])
  })

  it('handles a client with no primary dog', () => {
    expect(mergeClientDogs(null, [MILO])).toEqual([MILO])
    expect(mergeClientDogs(undefined, undefined)).toEqual([])
  })

  it('preserves the primary object, not the household copy', () => {
    // Both rows are the same Dog; whichever the caller selected on `dog` wins,
    // so a screen selecting extra columns on the primary keeps them.
    const primary: { id: string; name: string; breed: string | null } =
      { id: 'dog-bailey', name: 'Bailey', breed: 'Collie' }
    const additional = { id: 'dog-bailey', name: 'Bailey', breed: null }
    expect(mergeClientDogs(primary, [additional])[0].breed).toBe('Collie')
  })
})

describe('mergeClientDogsFlagged', () => {
  it('marks a both-relations dog as primary, and lists it once', () => {
    const flagged = mergeClientDogsFlagged(BAILEY, [BAILEY, MILO])
    expect(flagged).toHaveLength(2)
    expect(flagged[0]).toMatchObject({ id: 'dog-bailey', isPrimary: true })
    expect(flagged[1]).toMatchObject({ id: 'dog-milo', isPrimary: false })
  })

  it('flags nothing as primary when the client has no primary dog', () => {
    expect(mergeClientDogsFlagged(null, [MILO, BAILEY]).every(d => !d.isPrimary)).toBe(true)
  })
})

describe('extraClientDogs — what a "+N" badge means', () => {
  it('excludes the primary dog when it also sits on the household list', () => {
    // The clients list used to read "Bailey   +1 Bailey" for a one-dog client.
    expect(extraClientDogs('dog-bailey', [BAILEY])).toEqual([])
  })

  it('keeps the dogs that really are extra', () => {
    expect(extraClientDogs('dog-bailey', [BAILEY, MILO]).map(d => d.name)).toEqual(['Milo'])
  })

  it('treats every dog as extra when there is no primary', () => {
    expect(extraClientDogs(null, [BAILEY, MILO])).toHaveLength(2)
  })
})

describe('clientDogCount', () => {
  it('counts a both-relations dog once (dashboard total was inflated)', () => {
    expect(clientDogCount('dog-bailey', [BAILEY])).toBe(1)
  })

  it('counts primary plus genuine extras', () => {
    expect(clientDogCount('dog-bailey', [BAILEY, MILO])).toBe(2)
  })

  it('counts a household with no primary', () => {
    expect(clientDogCount(null, [BAILEY, MILO])).toBe(2)
  })

  it('counts zero for a client with no dogs at all', () => {
    expect(clientDogCount(null, [])).toBe(0)
  })
})

// The trainer-facing dogs API is the one call site a unit test can drive
// end-to-end, and it feeds the client-profile dog picker.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getClientAccess: vi.fn(),
  clientFindUnique: vi.fn(),
  dogFindMany: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/trainer-access', () => ({ getClientAccess: h.getClientAccess }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.clientFindUnique },
    dog: { findMany: h.dogFindMany, create: vi.fn() },
  },
}))

describe('GET /api/clients/[clientId]/dogs', () => {
  beforeEach(() => {
    Object.values(h).forEach(fn => fn.mockReset())
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 't1' } })
    h.getClientAccess.mockResolvedValue({ client: { id: 'c1', trainerId: 'co1' }, canEdit: true })
  })

  it('returns one entry for a dog that is both primary and additional', async () => {
    const { GET } = await import('@/app/api/clients/[clientId]/dogs/route')
    h.clientFindUnique.mockResolvedValue({ dog: BAILEY })
    h.dogFindMany.mockResolvedValue([BAILEY, MILO])

    const res = await GET(new Request('https://app.pupmanager.com/x'), {
      params: Promise.resolve({ clientId: 'c1' }),
    })
    const body = await res.json()

    expect(body.map((d: { id: string }) => d.id)).toEqual(['dog-bailey', 'dog-milo'])
    expect(body[0].isPrimary).toBe(true)
    expect(body[1].isPrimary).toBe(false)
  })
})
