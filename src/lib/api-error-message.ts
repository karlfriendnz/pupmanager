// One sentence to show a person when an API call came back not-ok.
//
// Every caller used to write `typeof body.error === 'string' ? body.error : "…try
// again."`, which quietly swallowed two different things:
//
//   • a Zod 400 answers with `error: parsed.error.flatten()` — an OBJECT — so a
//     validation failure rendered as the same generic sentence as a network blip
//     (or, where the value was passed straight to setState, as "[object Object]");
//   • a 500 has no `error` at all, which is how a real customer was told to "try
//     again" against a Stripe subscription that did not exist and never would.
//
// So: use the server's sentence when there is one, unpack Zod's shape when there
// isn't, and when there is genuinely nothing, say THAT rather than promising a
// retry will work.

const GENERIC_RETRY = 'Something went wrong. Please try again.'

export interface ApiErrorOptions {
  /** Sentence for a 4xx with no readable error — the caller's own wording. */
  fallback?: string
  /** Sentence for a 5xx / unexplained failure, where "try again" is a guess. */
  unexplained?: string
}

export function apiErrorMessage(
  body: unknown,
  status?: number,
  opts: ApiErrorOptions = {},
): string {
  const b = (body ?? {}) as { error?: unknown; message?: unknown }

  const direct = typeof b.error === 'string' ? b.error : typeof b.message === 'string' ? b.message : null
  if (direct && direct.trim()) return direct.trim()

  // Zod's flatten(): { formErrors: string[]; fieldErrors: Record<string, string[]> }
  if (b.error && typeof b.error === 'object') {
    const z = b.error as { formErrors?: unknown; fieldErrors?: unknown }
    const parts = [
      ...(Array.isArray(z.formErrors) ? z.formErrors : []),
      ...Object.values((z.fieldErrors ?? {}) as Record<string, unknown>).flatMap(v =>
        Array.isArray(v) ? v : [],
      ),
    ].filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    if (parts.length) return parts.join(' ')
  }

  if (status !== undefined && status >= 500) {
    return (
      opts.unexplained ??
      'Something went wrong at our end and we don’t know what yet. Please contact support — we can see the details.'
    )
  }
  return opts.fallback ?? GENERIC_RETRY
}
