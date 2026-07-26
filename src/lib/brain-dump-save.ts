// The one place the dashboard scratchpad is written back.
//
// It exists so the DEBOUNCED save and the FLUSH-ON-TEARDOWN save are the same
// request, and so the teardown path is unit-testable — a React effect cleanup
// can't be awaited, so the only thing worth asserting is that the right request
// was handed to the browser before the component went away.
export const BRAIN_DUMP_URL = '/api/brain-dump'

/**
 * PUT the brain-dump body.
 *
 * `keepalive`, NOT `navigator.sendBeacon`:
 *
 *  • sendBeacon can only POST, and can only set Content-Type from the Blob's
 *    own type — this endpoint is `PUT /api/brain-dump` with a JSON body, so a
 *    beacon would need a second, POST-shaped route that exists purely to work
 *    around the transport.
 *  • A plain `fetch()` started from an unmount cleanup (or a `pagehide`
 *    handler) is tied to the document: the browser is free to cancel it the
 *    moment the page/component goes away, which is exactly the window we're
 *    trying to survive. `keepalive: true` hands the request over to the
 *    browser, which completes it independently of the page — the same
 *    guarantee sendBeacon gives, without giving up the method or the headers.
 *
 * The keepalive body cap is 64 KB across all in-flight keepalive requests; the
 * route caps a brain dump at 50 000 characters, so an all-ASCII dump fits with
 * room to spare and a worst-case multibyte one is the only way to reach it.
 */
export function putBrainDump(
  body: string,
  opts: { keepalive?: boolean } = {},
): Promise<Response> {
  return fetch(BRAIN_DUMP_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
    keepalive: opts.keepalive ?? false,
  })
}
