import { describe, it, expect, vi, beforeEach } from 'vitest'

// Xero account/tax mapping route. Security/behaviour focus:
//   - owner-only (non-trainer / no trainerId → 401)
//   - GET 409s when the trainer hasn't connected Xero
//   - PUT saves connection defaults and scopes every per-item write by trainerId
//     (a client can't repoint another trainer's product to their own account)
const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  connFindUnique: vi.fn(),
  connUpdate: vi.fn(),
  productUpdateMany: vi.fn(),
  packageUpdateMany: vi.fn(),
  productFindMany: vi.fn(),
  packageFindMany: vi.fn(),
  fetchMappingOptions: vi.fn(),
  requireSameOrigin: vi.fn((): Response | null => null),
  $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/csrf', () => ({ requireSameOrigin: h.requireSameOrigin }))
vi.mock('@/lib/xero', () => ({ fetchMappingOptions: h.fetchMappingOptions }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    xeroConnection: { findUnique: h.connFindUnique, update: h.connUpdate },
    product: { updateMany: h.productUpdateMany, findMany: h.productFindMany },
    package: { updateMany: h.packageUpdateMany, findMany: h.packageFindMany },
    $transaction: h.$transaction,
  },
}))

import { GET, PUT } from '@/app/api/xero/mapping/route'

function asOwner(trainerId = 't-1') {
  h.getTrainerContext.mockResolvedValue({ userId: 'u-1', companyId: trainerId, membershipId: 'm-1', role: 'OWNER', permissions: {} })
}
function putReq(body: unknown) {
  return new Request('http://localhost/api/xero/mapping', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireSameOrigin.mockReturnValue(null)
  h.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops as Promise<unknown>[]))
})

describe('auth gating', () => {
  it('GET 401s when not an owner', async () => {
    h.getTrainerContext.mockResolvedValue({ userId: 'u-9', companyId: 't-1', membershipId: 'm', role: 'STAFF', permissions: {} })
    expect((await GET()).status).toBe(401)
  })

  it('PUT 401s when not an owner', async () => {
    h.getTrainerContext.mockResolvedValue(null)
    const res = await PUT(putReq({}))
    expect(res.status).toBe(401)
    expect(h.connUpdate).not.toHaveBeenCalled()
  })
})

describe('GET', () => {
  it('409s when the trainer has no Xero connection', async () => {
    asOwner()
    h.connFindUnique.mockResolvedValue(null)
    expect((await GET()).status).toBe(409)
  })

  it('returns options + current mapping when connected', async () => {
    asOwner()
    h.connFindUnique.mockResolvedValue({ id: 'c-1', bankAccountCode: '090', salesAccountCode: '200', taxType: 'OUTPUT2', accountShortlist: [{ code: '200', name: 'Sales', default: true }] })
    h.fetchMappingOptions.mockResolvedValue({ revenueAccounts: [{ code: '200', name: 'Sales' }], bankAccounts: [], taxRates: [] })

    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.mapping.bankAccountCode).toBe('090')
    expect(json.mapping.salesAccountCode).toBe('200')
    // Per-item accounts are set on the items now — the mapping no longer returns them.
    expect(json.mapping.packages).toBeUndefined()
    expect(json.mapping.accountShortlist[0].name).toBe('Sales')
  })
})

describe('PUT', () => {
  it('saves the connection-level defaults, scoped by trainerId', async () => {
    asOwner('t-1')
    const res = await PUT(putReq({
      bankAccountCode: '090',
      bankAccountName: 'Business Bank',
      salesAccountCode: '200',
      taxType: 'OUTPUT2',
    }))
    expect(res.status).toBe(200)

    expect(h.connUpdate).toHaveBeenCalledWith({
      where: { trainerId: 't-1' },
      // The route also persists the Stripe clearing-model account fields
      // (clearing/fee/surcharge). Unset in this payload, they normalise to null.
      data: {
        bankAccountCode: '090', bankAccountName: 'Business Bank', salesAccountCode: '200', taxType: 'OUTPUT2',
        clearingAccountCode: null, clearingAccountName: null, feeAccountCode: null, surchargeAccountCode: null,
      },
    })
    // Per-item accounts are set on the items themselves now — never here.
    expect(h.productUpdateMany).not.toHaveBeenCalled()
    expect(h.packageUpdateMany).not.toHaveBeenCalled()
  })

  it('respects the CSRF guard', async () => {
    asOwner()
    h.requireSameOrigin.mockReturnValue(new Response('no', { status: 403 }))
    const res = await PUT(putReq({}))
    expect(res.status).toBe(403)
    expect(h.connUpdate).not.toHaveBeenCalled()
  })
})
