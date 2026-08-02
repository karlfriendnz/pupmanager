import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Two doors now lead to the same add-on change, and they must let different
// people through.
//
//   POST  /api/addons                        — the business, for itself
//   PATCH /api/admin/trainers/[id]/addons    — a PupManager super-admin, for them
//
// The admin door exists because there was no third option this morning:
// hand-edit the database (which skips Stripe and hands a paid feature over free)
// or ask a paying customer to keep tapping a button that could not work. Opening
// it means the tenancy question has to be answered out loud:
//
//   • the trainer route takes its tenant from the SESSION and nowhere else, so a
//     trainer id in the body is inert;
//   • the admin route is admin-only, and a trainer — even the owner of the
//     account being changed — cannot use it;
//   • an admin action is recorded as an admin action.
const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  auth: vi.fn(),
  upsert: vi.fn(),
  profileFindUnique: vi.fn(),
  addonFindUnique: vi.fn(),
  billingItemUpsert: vi.fn(),
  billingItemFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  isStripeConfigured: vi.fn(),
  stripeFor: vi.fn(),
  resolvePriceId: vi.fn(),
  loadPriceIndex: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerAddon: { upsert: h.upsert, findUnique: h.addonFindUnique },
    trainerProfile: { findUnique: h.profileFindUnique },
    billingItem: { upsert: h.billingItemUpsert, findUnique: h.billingItemFindUnique },
    auditLog: { create: h.auditCreate },
  },
}))
vi.mock('@/lib/stripe', () => ({ stripeFor: h.stripeFor, isStripeConfigured: h.isStripeConfigured }))
vi.mock('@/lib/billing', () => ({ resolvePriceId: h.resolvePriceId, loadPriceIndex: h.loadPriceIndex }))

import { POST as trainerToggle } from '@/app/api/addons/route'
import { PATCH as adminChange, POST as adminComp } from '@/app/api/admin/trainers/[trainerId]/addons/route'

const FREE = 'timesheets'
const params = (id: string) => ({ params: Promise.resolve({ trainerId: id }) })

const trainerReq = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/addons', { method: 'POST', body: JSON.stringify(body) })
const adminReq = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/admin/trainers/u_victim/addons', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  h.upsert.mockResolvedValue({})
  h.billingItemUpsert.mockResolvedValue({})
  h.auditCreate.mockResolvedValue({})
  h.isStripeConfigured.mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a trainer can only change their OWN add-ons', () => {
  beforeEach(() => {
    h.getTrainerContext.mockResolvedValue({ userId: 'u_1', companyId: 'co_mine', role: 'OWNER', permissions: null })
  })

  it('ignores a trainerId smuggled into the body', async () => {
    const res = await trainerToggle(trainerReq({ itemId: FREE, active: true, trainerId: 'co_victim' }))
    expect(res.status).toBe(200)
    // The tenant came from the session, not the body.
    expect(h.upsert.mock.calls[0][0].where).toEqual({ trainerId_itemId: { trainerId: 'co_mine', itemId: FREE } })
    expect(h.upsert.mock.calls[0][0].create).toMatchObject({ trainerId: 'co_mine' })
  })

  it('ignores a companyId smuggled into the body', async () => {
    await trainerToggle(trainerReq({ itemId: FREE, active: false, companyId: 'co_victim' }))
    expect(h.upsert.mock.calls[0][0].where.trainerId_itemId.trainerId).toBe('co_mine')
  })

  it('records the change against their own business, never another', async () => {
    await trainerToggle(trainerReq({ itemId: FREE, active: true, trainerId: 'co_victim' }))
    expect(h.auditCreate.mock.calls[0][0].data).toMatchObject({ companyId: 'co_mine', actorUserId: 'u_1' })
  })

  it('a signed-out caller changes nothing', async () => {
    h.getTrainerContext.mockResolvedValue(null)
    const res = await trainerToggle(trainerReq({ itemId: FREE, active: true }))
    expect(res.status).toBe(401)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('a STAFF member without settings.edit is refused, and nothing is written', async () => {
    h.getTrainerContext.mockResolvedValue({
      userId: 'u_staff',
      companyId: 'co_mine',
      role: 'STAFF',
      permissions: { 'settings.edit': false, 'billing.seats': false },
    })
    const res = await trainerToggle(trainerReq({ itemId: FREE, active: true }))
    expect(res.status).toBe(403)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('a STAFF member cannot commit the business to a paid add-on', async () => {
    h.getTrainerContext.mockResolvedValue({
      userId: 'u_staff',
      companyId: 'co_mine',
      role: 'STAFF',
      permissions: { 'settings.edit': true, 'billing.seats': false },
    })
    const res = await trainerToggle(trainerReq({ itemId: 'achievements', active: true }))
    expect(res.status).toBe(403)
    expect(h.upsert).not.toHaveBeenCalled()
  })
})

describe('only a super admin can change an add-on for someone else', () => {
  beforeEach(() => {
    h.profileFindUnique.mockResolvedValue({ id: 'co_victim' })
    h.addonFindUnique.mockResolvedValue(null)
  })

  it('a signed-out caller is refused', async () => {
    h.auth.mockResolvedValue(null)
    const res = await adminChange(adminReq({ itemId: FREE, active: true }), params('u_victim'))
    expect(res.status).toBe(401)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('a TRAINER is refused — including the owner of the account being changed', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u_victim', role: 'TRAINER' } })
    const res = await adminChange(adminReq({ itemId: FREE, active: true }), params('u_victim'))
    expect(res.status).toBe(401)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('a CLIENT is refused', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u_client', role: 'CLIENT' } })
    const res = await adminChange(adminReq({ itemId: FREE, active: true }), params('u_victim'))
    expect(res.status).toBe(401)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('the comp route (POST) is gated the same way', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u_2', role: 'TRAINER' } })
    const res = await adminComp(adminReq({ itemId: FREE, active: true }), params('u_victim'))
    expect(res.status).toBe(401)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('an ADMIN changes it, against the target business — not their own', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u_admin', role: 'ADMIN' } })
    const res = await adminChange(adminReq({ itemId: FREE, active: true }), params('u_victim'))
    expect(res.status).toBe(200)
    // Resolved from the URL's User id to that business's TrainerProfile id.
    expect(h.profileFindUnique).toHaveBeenCalledWith({ where: { userId: 'u_victim' }, select: { id: true } })
    expect(h.upsert.mock.calls[0][0].where).toEqual({ trainerId_itemId: { trainerId: 'co_victim', itemId: FREE } })
  })

  it('and it is recorded as an ADMIN action, with the admin named', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u_admin', role: 'ADMIN' } })
    await adminChange(adminReq({ itemId: FREE, active: false }), params('u_victim'))

    const entry = h.auditCreate.mock.calls[0][0].data
    expect(entry).toMatchObject({ companyId: 'co_victim', actorUserId: 'u_admin', targetType: 'addon' })
    // `via: admin` is Karl's "including if you do it" — a change made for a
    // customer must never read as the customer's own decision.
    expect(entry.meta).toMatchObject({ via: 'admin', active: false, outcome: 'applied' })
  })

  it('an unknown trainer is a 404, and touches nothing', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u_admin', role: 'ADMIN' } })
    h.profileFindUnique.mockResolvedValue(null)
    const res = await adminChange(adminReq({ itemId: FREE, active: true }), params('u_ghost'))
    expect(res.status).toBe(404)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('goes through the SAME Stripe refusal as the trainer would have seen', async () => {
    // The point of the admin path is that it is not a shortcut. A broken
    // subscription must refuse the admin exactly as it refused the customer,
    // rather than quietly writing the row and handing over a paid feature free.
    h.auth.mockResolvedValue({ user: { id: 'u_admin', role: 'ADMIN' } })
    h.profileFindUnique
      .mockResolvedValueOnce({ id: 'co_victim' })
      .mockResolvedValueOnce({ stripeSubscriptionId: 'sub_dead', sandboxBilling: false, trialEndsAt: null })
    h.stripeFor.mockReturnValue({
      subscriptions: {
        retrieve: vi.fn().mockRejectedValue(
          Object.assign(new Error("No such subscription: 'sub_dead'"), {
            type: 'StripeInvalidRequestError',
            code: 'resource_missing',
          }),
        ),
        update: vi.fn(),
      },
    })

    const res = await adminChange(adminReq({ itemId: 'achievements', active: true }), params('u_victim'))
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.reason).toBe('subscription_missing')
    expect(h.upsert).not.toHaveBeenCalled()
    expect(h.auditCreate.mock.calls[0][0].data.meta).toMatchObject({ via: 'admin', outcome: 'failed' })
  })
})
