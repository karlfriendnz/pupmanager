import { describe, it, expect, vi, beforeEach } from 'vitest'

// Xero OAuth/API client. The contract under test:
//   - authorize URL carries the right OAuth params + our CSRF state
//   - getValidAccessToken returns the CACHED token while it's fresh (no refresh)
//   - …and refreshes + persists the ROTATED refresh token when it's stale
//   - xeroFetch attaches the Bearer token and the required Xero-tenant-id header

vi.mock('@/lib/env', () => ({
  env: {
    XERO_CLIENT_ID: 'client-id',
    XERO_CLIENT_SECRET: 'client-secret',
    NEXT_PUBLIC_APP_URL: 'https://app.example.com',
  },
}))

const { update } = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { xeroConnection: { update } } }))
update.mockResolvedValue({})

import {
  isXeroConfigured,
  xeroRedirectUri,
  xeroAuthorizeUrl,
  getValidAccessToken,
  xeroFetch,
  fetchMappingOptions,
  ensureXeroContact,
  createXeroInvoice,
} from '@/lib/xero'

type Conn = Parameters<typeof getValidAccessToken>[0]
function conn(over: Partial<Conn> = {}): Conn {
  return {
    id: 'conn-1',
    trainerId: 'trainer-1',
    refreshToken: 'refresh-old',
    accessToken: null,
    accessTokenExpiresAt: null,
    tenantId: 'tenant-1',
    tenantName: 'Demo Org',
    bankAccountCode: null,
    bankAccountName: null,
    salesAccountCode: null,
    taxType: null,
    connectedAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as Conn
}

beforeEach(() => vi.clearAllMocks())

describe('config + authorize URL', () => {
  it('is configured when both id and secret are present', () => {
    expect(isXeroConfigured()).toBe(true)
  })

  it('builds the redirect URI off the app URL', () => {
    expect(xeroRedirectUri()).toBe('https://app.example.com/api/xero/callback')
  })

  it('authorize URL carries client_id, redirect_uri, offline_access scope and state', () => {
    const url = new URL(xeroAuthorizeUrl('state-123'))
    expect(url.origin + url.pathname).toBe('https://login.xero.com/identity/connect/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/xero/callback')
    expect(url.searchParams.get('state')).toBe('state-123')
    expect(url.searchParams.get('scope')).toContain('offline_access')
    expect(url.searchParams.get('scope')).toContain('accounting.transactions')
  })
})

describe('getValidAccessToken', () => {
  it('returns the cached token without refreshing when it is still fresh', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const token = await getValidAccessToken(
      conn({ accessToken: 'cached', accessTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000) }),
    )
    expect(token).toBe('cached')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('refreshes and persists the rotated refresh token when stale', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access-new', refresh_token: 'refresh-rotated', expires_in: 1800 }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const token = await getValidAccessToken(conn({ accessTokenExpiresAt: new Date(Date.now() - 1000) }))

    expect(token).toBe('access-new')
    // token endpoint hit with a refresh_token grant carrying the OLD token
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://identity.xero.com/connect/token')
    expect(String(init.body)).toContain('grant_type=refresh_token')
    expect(String(init.body)).toContain('refresh-old')
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /)
    // the rotated refresh token + new access token are persisted
    expect(update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: expect.objectContaining({ refreshToken: 'refresh-rotated', accessToken: 'access-new' }),
    })
  })

  it('throws when the refresh request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad' }))
    await expect(getValidAccessToken(conn())).rejects.toThrow(/Xero token request failed/)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('xeroFetch', () => {
  it('sends the Bearer token and Xero-tenant-id header to the API base', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)

    await xeroFetch(
      conn({ accessToken: 'tok', accessTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000) }),
      '/Contacts',
    )

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.xero.com/api.xro/2.0/Contacts')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(init.headers['Xero-tenant-id']).toBe('tenant-1')
  })
})

describe('fetchMappingOptions', () => {
  const fresh = conn({ accessToken: 'tok', accessTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000) })

  function stubAccountsAndTax(accounts: unknown[], taxRates: unknown[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const body = String(url).includes('/TaxRates') ? { TaxRates: taxRates } : { Accounts: accounts }
        return Promise.resolve({ ok: true, json: async () => body })
      }),
    )
  }

  it('keeps only ACTIVE revenue accounts, BANK accounts, and revenue-applicable tax rates', async () => {
    stubAccountsAndTax(
      [
        { Code: '200', Name: 'Sales', Type: 'REVENUE', Class: 'REVENUE', Status: 'ACTIVE' },
        { Code: '260', Name: 'Other Revenue', Type: 'OTHERINCOME', Class: 'REVENUE', Status: 'ACTIVE' },
        { Code: '090', Name: 'Business Bank', Type: 'BANK', Class: 'ASSET', Status: 'ACTIVE' },
        { Code: '400', Name: 'Advertising', Type: 'EXPENSE', Class: 'EXPENSE', Status: 'ACTIVE' }, // dropped
        { Code: '201', Name: 'Archived Sales', Type: 'REVENUE', Class: 'REVENUE', Status: 'ARCHIVED' }, // dropped
        { Name: 'No Code Revenue', Class: 'REVENUE', Status: 'ACTIVE' }, // dropped (no code)
      ],
      [
        { Name: 'GST on Income', TaxType: 'OUTPUT2', Status: 'ACTIVE', CanApplyToRevenue: true },
        { Name: 'GST on Expenses', TaxType: 'INPUT2', Status: 'ACTIVE', CanApplyToRevenue: false }, // dropped
        { Name: 'Old Rate', TaxType: 'OLD', Status: 'DELETED', CanApplyToRevenue: true }, // dropped
      ],
    )

    const opts = await fetchMappingOptions(fresh)
    expect(opts.revenueAccounts.map((a) => a.code).sort()).toEqual(['200', '260'])
    expect(opts.bankAccounts.map((a) => a.code)).toEqual(['090'])
    expect(opts.taxRates).toEqual([{ taxType: 'OUTPUT2', name: 'GST on Income' }])
  })

  it('throws when the Accounts request errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 401, text: async () => 'unauthorised' })),
    )
    await expect(fetchMappingOptions(fresh)).rejects.toThrow(/Xero GET/)
  })
})

describe('ensureXeroContact', () => {
  const fresh = conn({ accessToken: 'tok', accessTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000) })

  it('short-circuits to the known contact id without any API call', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const id = await ensureXeroContact(fresh, { name: 'Jo', existingContactId: 'C-EXIST' })
    expect(id).toBe('C-EXIST')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('matches an existing contact by email before creating', async () => {
    const fetchSpy = vi.fn((url: string) => {
      expect(String(url)).toContain('/Contacts?where=')
      return Promise.resolve({ ok: true, json: async () => ({ Contacts: [{ ContactID: 'C-BY-EMAIL' }] }) })
    })
    vi.stubGlobal('fetch', fetchSpy)
    const id = await ensureXeroContact(fresh, { name: 'Jo', email: 'jo@example.com' })
    expect(id).toBe('C-BY-EMAIL')
    // only the email lookup — no POST create
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('creates a contact when no email match exists', async () => {
    const calls: Array<{ url: string; method: string }> = []
    const fetchSpy = vi.fn((url: string, init?: { method?: string }) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' })
      if (init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ Contacts: [{ ContactID: 'C-NEW' }] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ Contacts: [] }) }) // email lookup: no match
    })
    vi.stubGlobal('fetch', fetchSpy)
    const id = await ensureXeroContact(fresh, { name: 'New Person', email: 'new@example.com' })
    expect(id).toBe('C-NEW')
    expect(calls.some((c) => c.method === 'POST')).toBe(true)
  })

  it('on a name collision with an email, re-creates under a disambiguated name', async () => {
    let postCount = 0
    const bodies: string[] = []
    const fetchSpy = vi.fn((url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST') {
        postCount++
        bodies.push(String(init.body))
        // first create fails (name taken), second (disambiguated) succeeds
        return postCount === 1
          ? Promise.resolve({ ok: false, status: 400, json: async () => ({}) })
          : Promise.resolve({ ok: true, json: async () => ({ Contacts: [{ ContactID: 'C-DISAMB' }] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ Contacts: [] }) }) // email lookup: no match
    })
    vi.stubGlobal('fetch', fetchSpy)
    const id = await ensureXeroContact(fresh, { name: 'John Smith', email: 'john2@example.com' })
    expect(id).toBe('C-DISAMB')
    expect(postCount).toBe(2)
    expect(bodies[1]).toContain('John Smith (john2@example.com)')
  })

  it('without an email, reuses the same-named contact on collision', async () => {
    const fetchSpy = vi.fn((url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return Promise.resolve({ ok: false, status: 400, json: async () => ({}) })
      return Promise.resolve({ ok: true, json: async () => ({ Contacts: [{ ContactID: 'C-EXISTING-NAME' }] }) })
    })
    vi.stubGlobal('fetch', fetchSpy)
    const id = await ensureXeroContact(fresh, { name: 'Acme Co' })
    expect(id).toBe('C-EXISTING-NAME')
  })
})

describe('createXeroInvoice', () => {
  const fresh = conn({ accessToken: 'tok', accessTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000) })

  it('POSTs an AUTHORISED ACCREC invoice with major-unit amounts and returns the id', async () => {
    let sentBody: Record<string, unknown> = {}
    const fetchSpy = vi.fn((url: string, init?: { method?: string; body?: string }) => {
      sentBody = JSON.parse(String(init?.body))
      return Promise.resolve({ ok: true, json: async () => ({ Invoices: [{ InvoiceID: 'INV-1' }] }) })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const id = await createXeroInvoice(fresh, {
      contactId: 'C-1',
      reference: 'pay-1',
      hasTax: true,
      lines: [{ description: 'Puppy Course', quantity: 1, unitAmountMinor: 12500, accountCode: '200', taxType: 'OUTPUT2' }],
    })

    expect(id).toBe('INV-1')
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.xero.com/api.xro/2.0/Invoices')
    expect(init!.method).toBe('POST')
    expect(sentBody.Type).toBe('ACCREC')
    expect(sentBody.Status).toBe('AUTHORISED')
    expect(sentBody.LineAmountTypes).toBe('Inclusive')
    expect((sentBody.Contact as { ContactID: string }).ContactID).toBe('C-1')
    const line = (sentBody.LineItems as Array<Record<string, unknown>>)[0]
    expect(line.UnitAmount).toBe(125) // 12500 minor → 125.00 major
    expect(line.AccountCode).toBe('200')
    expect(line.TaxType).toBe('OUTPUT2')
  })

  it('uses NoTax and omits TaxType when the trainer has no tax rate', async () => {
    let sentBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn((url: string, init?: { body?: string }) => {
      sentBody = JSON.parse(String(init?.body))
      return Promise.resolve({ ok: true, json: async () => ({ Invoices: [{ InvoiceID: 'INV-2' }] }) })
    }))
    await createXeroInvoice(fresh, {
      contactId: 'C-1', hasTax: false,
      lines: [{ description: 'Treats', quantity: 2, unitAmountMinor: 500, accountCode: '260' }],
    })
    expect(sentBody.LineAmountTypes).toBe('NoTax')
    expect((sentBody.LineItems as Array<Record<string, unknown>>)[0]).not.toHaveProperty('TaxType')
  })

  it('throws when Xero rejects the invoice', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 400, text: async () => 'validation error' })))
    await expect(
      createXeroInvoice(fresh, { contactId: 'C-1', hasTax: false, lines: [{ description: 'x', quantity: 1, unitAmountMinor: 100, accountCode: '200' }] }),
    ).rejects.toThrow(/Xero invoice create failed/)
  })
})
