// Open-redirect guard. Any post-auth / post-action redirect target that comes
// from a URL param (next, callbackUrl, redirectTo, returnUrl) MUST be passed
// through this so an attacker can't craft e.g.
//   /verify-account?next=https://evil.com
// and bounce a freshly-authenticated user off-site (phishing / token theft).
//
// We only allow a same-origin *relative* path: it must start with a single "/"
// and must NOT start with "//" or "/\" (protocol-relative → external) and must
// not contain a scheme or backslashes. Anything else falls back to `fallback`.
export function safeInternalPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback
  let value = raw.trim()
  // Decode once so an encoded "//evil.com" or "https:%2F%2F" can't slip past.
  try {
    value = decodeURIComponent(value)
  } catch {
    return fallback
  }
  // Must be a path: single leading slash, not protocol-relative, no scheme,
  // no backslashes (browsers treat "\" like "/" in some contexts).
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\') ||
    value.includes('\\') ||
    /^\/?[a-z][a-z0-9+.-]*:/i.test(value) // scheme like "javascript:" / "http:"
  ) {
    return fallback
  }
  return value
}
