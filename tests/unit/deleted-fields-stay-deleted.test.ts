import { describe, it, expect, vi, beforeEach } from 'vitest'

// Starter fields are seeded from the trainer's trade ("a groomer gets coat type
// / last groomed"). applyFieldPackKeys dedups on the labels that CURRENTLY
// exist, which is not the same as remembering what it once created: delete a
// starter field you don't want, then save anything on Settings → Business
// details — a form that posts businessRoles every time, unchanged — and the
// field was created again, because its label was no longer taken.
//
// Deleted fields kept coming back and there was no way to make them stay gone.
// Packs now only apply for a trade the trainer has just ADDED.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  profileFindUnique: vi.fn(),
  profileFindFirst: vi.fn(),
  profileUpdate: vi.fn(),
  applyFieldPacksForRoles: vi.fn(),
  seedScheduleDefaultsForRoles: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u_1', role: 'TRAINER' } })) }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
// The route revalidates the client home after a successful write; outside a
// request scope the real one throws "static generation store missing".
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: {
      findUnique: h.profileFindUnique,
      findFirst: h.profileFindFirst,
      update: h.profileUpdate,
    },
  },
}))
vi.mock('@/lib/onboarding/apply-field-packs', () => ({
  applyFieldPacksForRoles: h.applyFieldPacksForRoles,
}))
vi.mock('@/lib/onboarding/schedule-defaults', () => ({
  seedScheduleDefaultsForRoles: h.seedScheduleDefaultsForRoles,
}))

import { PATCH } from '@/app/api/trainer/profile/route'

const COMPANY = 'tr_1'

function req(body: unknown): Request {
  return new Request('https://app.pupmanager.com/api/trainer/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockReset()
  h.guardPermission.mockResolvedValue({ userId: 'u_1', companyId: COMPANY })
  h.profileUpdate.mockResolvedValue({ id: COMPANY })
  h.profileFindFirst.mockResolvedValue(null)
  h.applyFieldPacksForRoles.mockResolvedValue(0)
  h.seedScheduleDefaultsForRoles.mockResolvedValue(0)
})

describe('PATCH /api/trainer/profile — deleted starter fields stay deleted', () => {
  it('seeds nothing when the trade is unchanged', async () => {
    h.profileFindUnique.mockResolvedValue({ businessRoles: ['groomer'] })

    const res = await PATCH(req({ businessRoles: ['groomer'] }))

    expect(res.status).toBe(200)
    expect(h.applyFieldPacksForRoles).not.toHaveBeenCalled()
  })

  it('seeds only the trade just added, not the ones already there', async () => {
    h.profileFindUnique.mockResolvedValue({ businessRoles: ['groomer'] })

    await PATCH(req({ businessRoles: ['groomer', 'daycare'] }))

    expect(h.applyFieldPacksForRoles).toHaveBeenCalledWith(expect.anything(), COMPANY, ['daycare'])
  })

  it('still seeds for a trainer telling us their trade for the first time', async () => {
    h.profileFindUnique.mockResolvedValue({ businessRoles: [] })

    await PATCH(req({ businessRoles: ['groomer'] }))

    expect(h.applyFieldPacksForRoles).toHaveBeenCalledWith(expect.anything(), COMPANY, ['groomer'])
  })

  // Removing a trade is not a reason to seed anything.
  it('seeds nothing when a trade is dropped', async () => {
    h.profileFindUnique.mockResolvedValue({ businessRoles: ['groomer', 'daycare'] })

    await PATCH(req({ businessRoles: ['groomer'] }))

    expect(h.applyFieldPacksForRoles).not.toHaveBeenCalled()
  })

  // The everyday case: saving a name or a phone number on the same form. It
  // posts no roles at all, and must never touch the field list.
  it('seeds nothing on a save that isn’t about the trade', async () => {
    await PATCH(req({ businessName: 'In the Nic of Time Dog Training' }))

    expect(h.applyFieldPacksForRoles).not.toHaveBeenCalled()
    expect(h.seedScheduleDefaultsForRoles).not.toHaveBeenCalled()
  })

  it('holds the working hours to the same rule', async () => {
    h.profileFindUnique.mockResolvedValue({ businessRoles: ['groomer'] })

    await PATCH(req({ businessRoles: ['groomer'] }))

    expect(h.seedScheduleDefaultsForRoles).not.toHaveBeenCalled()
  })
})
