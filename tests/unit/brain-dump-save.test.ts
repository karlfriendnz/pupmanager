import { describe, it, expect, beforeEach, vi } from 'vitest'
import { putBrainDump, BRAIN_DUMP_URL } from '@/lib/brain-dump-save'

// The brain dump's teardown flush is the only save that has to survive the
// component going away. What "survives" means in practice is a single property
// on the request — `keepalive` — so that is what's asserted here: an unmount
// cleanup can't be awaited, so the guarantee has to live in the request itself
// rather than in anything the component does afterwards.

describe('putBrainDump', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('PUTs JSON to the brain-dump route', async () => {
    await putBrainDump('walk Bailey at 3')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(BRAIN_DUMP_URL)
    expect(init.method).toBe('PUT')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({ body: 'walk Bailey at 3' })
  })

  it('is an ordinary cancellable fetch while the panel is alive', async () => {
    await putBrainDump('typing')
    expect(fetchMock.mock.calls[0][1].keepalive).toBe(false)
  })

  it('sets keepalive when flushing on teardown, so the browser finishes it', async () => {
    await putBrainDump('the last 800ms of typing', { keepalive: true })

    const init = fetchMock.mock.calls[0][1]
    expect(init.keepalive).toBe(true)
    // The method and content type must survive too — this is why the flush
    // can't be a navigator.sendBeacon (POST only, Blob-typed body).
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ body: 'the last 800ms of typing' })
  })

  it('does not await anything the caller has to keep alive', () => {
    // Fire-and-forget: the request is issued synchronously, before the promise
    // settles, so a caller that is being torn down never has to hold on.
    void putBrainDump('x', { keepalive: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
