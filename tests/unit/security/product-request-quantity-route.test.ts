import { describe, it, expect, vi, beforeEach } from 'vitest'

// The quantity control in the browser is not the check (AGENTS.md #3).
//
// `<input type="number" min="1" max="20">` refuses 0, -1, 2.5 and 500 on
// screen, and a POST straight at the route refuses none of them unless the
// route says so. This one moves STOCK and MONEY: a quantity of 0 is a sale that
// takes nothing off the shelf and bills for nothing; 2.5 is not a number of
// harnesses; 500 empties a shelf on one tap.
//
// Both client-facing and trainer-facing entry points are covered, because the
// trainer's is the one that was just built and the client's is the one anyone
// can reach.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getClientAccess: vi.fn(),
  productFindFirst: vi.fn(),
  placeProductOrder: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/trainer-access', () => ({ getClientAccess: h.getClientAccess }))
vi.mock('@/lib/prisma', () => ({
  prisma: { product: { findFirst: h.productFindFirst } },
}))
vi.mock('@/lib/product-requests', () => ({ placeProductOrder: h.placeProductOrder }))

import { POST } from '@/app/api/clients/[clientId]/product-requests/route'

const CLIENT = 'client_1'

const post = (body: Record<string, unknown>) =>
  POST(
    new Request(`https://app.pupmanager.com/api/clients/${CLIENT}/product-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ clientId: CLIENT }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'user_1', role: 'TRAINER', trainerId: 'trainer_1' } })
  h.getClientAccess.mockResolvedValue({
    canEdit: true,
    client: { trainerId: 'trainer_1' },
  })
  h.productFindFirst.mockResolvedValue({
    id: 'prod_1', name: 'Front-clip harness', stockCount: 10, variants: [],
  })
  h.placeProductOrder.mockResolvedValue({
    ok: true, request: { id: 'req_1', quantity: 2 }, created: true, added: 2,
  })
})

describe('POST /api/clients/[clientId]/product-requests — quantity bounds', () => {
  it('accepts a whole number in range', async () => {
    const res = await post({ productId: 'prod_1', quantity: 3 })
    expect(res.status).toBe(201)
    expect(h.placeProductOrder).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3 }))
  })

  it.each([0, -1, 2.5, 21, 500, Number.NaN])('refuses %s outright', async (quantity) => {
    const res = await post({ productId: 'prod_1', quantity })
    expect(res.status).toBe(400)
    // Refused BEFORE anything moves — no stock taken, no row written, no money.
    expect(h.placeProductOrder).not.toHaveBeenCalled()
  })

  it.each(['3', null, true, {}])('refuses a quantity that is not a number: %s', async (quantity) => {
    const res = await post({ productId: 'prod_1', quantity })
    expect(res.status).toBe(400)
    expect(h.placeProductOrder).not.toHaveBeenCalled()
  })

  it('a body with no quantity still means one', async () => {
    // Every caller that predates the control, and every phone still running the
    // old build.
    const res = await post({ productId: 'prod_1' })
    expect(res.status).toBe(201)
    expect(h.placeProductOrder).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: undefined }),
    )
  })

  it('passes a short shelf straight back as a 409', async () => {
    h.placeProductOrder.mockResolvedValue({
      ok: false, status: 409, error: 'Only 2 of Front-clip harness left — you asked for 5.',
    })
    const res = await post({ productId: 'prod_1', quantity: 5 })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Only 2 of/)
  })

  it('answers 200 rather than 201 when it grew an order that already existed', async () => {
    // A created row and a grown one are different events, and the caller reads
    // the difference off the status.
    h.placeProductOrder.mockResolvedValue({
      ok: true, request: { id: 'req_1', quantity: 5 }, created: false, added: 3,
    })
    const res = await post({ productId: 'prod_1', quantity: 3 })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ quantity: 5 })
  })

  it('still refuses a quantity from someone who cannot edit this client', async () => {
    // The bounds are not the only guard, and neither is a substitute for the
    // other: a valid quantity from the wrong trainer is still a 404.
    h.getClientAccess.mockResolvedValue(null)
    const res = await post({ productId: 'prod_1', quantity: 2 })
    expect(res.status).toBe(404)
    expect(h.placeProductOrder).not.toHaveBeenCalled()
  })
})
