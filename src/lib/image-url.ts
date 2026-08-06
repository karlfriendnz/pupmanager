/**
 * The one check every trainer-set picture URL goes through before it is stored.
 *
 * These strings end up in an `<img src>` on a CLIENT's screen, so the value is
 * an XSS boundary in the same way a description is — the trainer authors it, a
 * client views it. A URL arriving at an API is NOT the URL our uploader
 * returned just because the form usually sends that one; anyone can POST.
 *
 * What survives: an absolute http/https URL, trimmed, under the length any real
 * blob URL is. Everything else — `javascript:`, `data:`, a relative path, a
 * protocol-relative `//evil`, an object, a 4 KB string — comes back null, which
 * every caller treats as "no picture set" and therefore "borrow one".
 *
 * Returns null rather than throwing: a bad URL is a field to ignore, not a
 * reason to 500 a save that also carried a perfectly good name.
 */
export const IMAGE_URL_MAX = 2048

export function sanitizeImageUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const value = input.trim()
  if (!value || value.length > IMAGE_URL_MAX) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    // Relative paths and `//host/x` land here — deliberately refused rather than
    // resolved against some assumed origin.
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return value
}
