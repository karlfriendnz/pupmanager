/**
 * Turn whatever an API route put in `error` into one sentence a trainer can act
 * on.
 *
 * Routes answer a failed Zod parse with `{ error: parsed.error.flatten() }` —
 * an object, not a string. Forms that only handled the string case showed a
 * blank "Save failed" and threw the actual reason away, which is how an
 * `imageUrl: Invalid URL` rejection looked like the product page being broken.
 */
export function readApiError(body: unknown, fallback = 'Save failed'): string {
  if (typeof body === 'string') return body
  if (!body || typeof body !== 'object') return fallback

  const error = (body as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (!error || typeof error !== 'object') return fallback

  const flattened = error as {
    formErrors?: unknown
    fieldErrors?: Record<string, unknown>
  }

  const messages: string[] = []

  if (Array.isArray(flattened.formErrors)) {
    for (const m of flattened.formErrors) if (typeof m === 'string') messages.push(m)
  }

  if (flattened.fieldErrors && typeof flattened.fieldErrors === 'object') {
    for (const [field, errs] of Object.entries(flattened.fieldErrors)) {
      if (!Array.isArray(errs)) continue
      for (const m of errs) {
        if (typeof m === 'string') messages.push(`${labelFor(field)}: ${m}`)
      }
    }
  }

  return messages.length ? messages.join(' · ') : fallback
}

/** camelCase field name → something readable next to the message. */
function labelFor(field: string): string {
  const spaced = field.replace(/([A-Z])/g, ' $1').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
