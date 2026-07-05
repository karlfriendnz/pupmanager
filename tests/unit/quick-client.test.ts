import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createQuickClient } from '@/lib/quick-client'

// createQuickClient powers the "+ New client" inline-create in the schedule
// assign-package modal: POST /api/clients (mode: 'quick') → the new client
// mapped back into the picker's { id, name, dogs } option shape.
function mockFetch(res: { ok: boolean; body: unknown }) {
  const fn = vi.fn(async () => ({ ok: res.ok, json: async () => res.body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('createQuickClient', () => {
  it('POSTs mode:quick with the (trimmed) name and returns the new client option', async () => {
    const fetchMock = mockFetch({ ok: true, body: { ok: true, clientId: 'cp-new', dogIds: [] } })
    const r = await createQuickClient({ name: '  Sam Jones ' })

    expect(r).toEqual({ ok: true, client: { id: 'cp-new', name: 'Sam Jones', dogs: [] } })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; body: string }]
    expect(url).toBe('/api/clients')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toMatchObject({ mode: 'quick', name: 'Sam Jones', dogs: [] })
  })

  it('sends the dog + email + phone and maps the dog id back onto the option', async () => {
    const fetchMock = mockFetch({ ok: true, body: { ok: true, clientId: 'cp-1', dogIds: ['dog-1'] } })
    const r = await createQuickClient({ name: 'Jo', email: 'jo@x.com', phone: '021', dogName: ' Bailey ' })

    expect(r).toEqual({ ok: true, client: { id: 'cp-1', name: 'Jo', dogs: [{ id: 'dog-1', name: 'Bailey' }] } })
    const init = (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1]
    expect(JSON.parse(init.body)).toMatchObject({
      mode: 'quick', name: 'Jo', email: 'jo@x.com', phone: '021', dogs: [{ name: 'Bailey' }],
    })
  })

  it('surfaces the API error message on failure', async () => {
    mockFetch({ ok: false, body: { error: 'Name is required' } })
    expect(await createQuickClient({ name: 'X' })).toEqual({ ok: false, error: 'Name is required' })
  })

  it('does not POST when the name is blank', async () => {
    const fetchMock = mockFetch({ ok: true, body: {} })
    const r = await createQuickClient({ name: '   ' })
    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never throws — a network error becomes an error result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    const r = await createQuickClient({ name: 'Jo' })
    expect(r.ok).toBe(false)
  })
})
