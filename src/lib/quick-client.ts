// Shared helper for the "+ New client" inline-create affordance (used from the
// schedule assign-package modal). Mirrors the quick-add-contact POST shape and
// maps the API's response back into the `{ id, name, dogs }` option shape the
// pickers use — so the caller can add + select the new client without any
// navigation. Kept framework-free (just `fetch`) so it's unit-testable.

export interface QuickClientOption {
  id: string
  name: string
  dogs: { id: string; name: string }[]
}

export interface QuickClientInput {
  name: string
  email?: string
  phone?: string
  dogName?: string
}

export type QuickClientResult =
  | { ok: true; client: QuickClientOption }
  | { ok: false; error: string }

/**
 * Create a client via the quick-add path (`POST /api/clients` with
 * `mode: 'quick'`). Returns the new client as a picker option on success, or a
 * user-facing error message on failure. Never throws.
 */
export async function createQuickClient(input: QuickClientInput): Promise<QuickClientResult> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Enter a name.' }
  const dogName = input.dogName?.trim()

  try {
    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'quick',
        name,
        email: input.email?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
        // Only send a dog when one was actually named (mirrors quick-add-contact).
        dogs: dogName ? [{ name: dogName }] : [],
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body?.clientId) {
      return { ok: false, error: typeof body?.error === 'string' ? body.error : 'Could not create client.' }
    }
    const firstDogId: string | undefined = Array.isArray(body.dogIds) ? body.dogIds[0] : undefined
    return {
      ok: true,
      client: {
        id: body.clientId,
        name,
        dogs: dogName && firstDogId ? [{ id: firstDogId, name: dogName }] : [],
      },
    }
  } catch {
    return { ok: false, error: 'Could not create client. Please try again.' }
  }
}
