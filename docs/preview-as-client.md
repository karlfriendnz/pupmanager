# Preview-as-client mode

> **Status:** Shipped 2026-05-07.
> **Entry point:** `/preview-as/[clientId]` (linked from the trainer's client list and the onboarding wizard).

## What it does

Lets a trainer walk the entire client app for **one specific client** as if they were that client, so they can verify what the client actually sees — sessions, homework, achievements, shop, etc. The whole `(client)` route group becomes accessible to the trainer for the duration of a preview session.

## How it's wired

1. **Entry** — `src/app/preview-as/[clientId]/route.ts` (a `GET` route handler) verifies the caller is a trainer who owns the client, drops a `pm-preview-client=<clientId>` cookie (httpOnly, 1-hour TTL), and 307s to `/home`.

2. **Middleware unlock** — `src/proxy.ts` normally bounces trainers away from `CLIENT_PATHS` (anything under `/home`, `/my-*`, `/notifications`). When the preview cookie is present it lets the request through.

3. **Identity resolution** — `src/lib/client-context.ts` exports `getActiveClient()`, a `react/cache`-wrapped helper that returns:
   ```ts
   { clientId, userId, isPreview, actualUserId }
   ```
   - For a real signed-in client: looks up their profile by `session.user.id`.
   - For a trainer with a valid preview cookie: returns the previewed client's `id`/`userId` and `isPreview: true`.

4. **Page wiring** — every page in `src/app/(client)/**` calls `getActiveClient()` instead of reading `session.user.id` directly. Use `active.clientId` for `clientProfile` lookups and `active.userId` for queries scoped to the client's own user (notifications, message sender filter, etc).

5. **Banner** — `src/app/(client)/preview-banner.tsx` is rendered by the `(client)` layout when `active.isPreview` is true. Contains an Exit button (server-action form) that clears the cookie and bounces back to `/clients/[clientId]`.

6. **Mutation policy** — most `/api/my/*` endpoints used to gate on `session.user.role === 'CLIENT'`. They've been (or should be) migrated to use `getActiveClient()` so trainers in preview can also exercise mutation flows (homework completion, shop requests, etc.) end-to-end. The trainer's `role` is still `TRAINER` — do not check `role` in client-mutation endpoints; check that `getActiveClient()` returns a profile.

## Read-only surfaces

In preview mode we deliberately **don't** mark messages as read (see `src/app/(client)/my-messages/page.tsx`) — leaving the client's true unread state intact.

The intake gate is **skipped** in preview (see `src/app/(client)/layout.tsx`) so trainers walking through aren't trapped on a data-entry form they can't legitimately fill in.

## Cookie

| Field    | Value                            |
|----------|----------------------------------|
| Name     | `pm-preview-client`              |
| Value    | `<clientId>`                     |
| HttpOnly | yes                              |
| SameSite | lax                              |
| Path     | `/`                              |
| MaxAge   | `60 * 60` (1 hour)               |

The constant lives at `src/lib/client-context.ts:PREVIEW_COOKIE` — import from there, never hardcode.

## Tests

- `tests/smoke/preview-as.spec.ts` — exercises the route handler unauth-side (verifies it 307s to /login and that `/home` doesn't accept a trainer without the cookie).
- `tests/smoke/pages.spec.ts` — visits every route in the app and asserts non-500. Catches the bug class where a `(client)` page breaks on the trainer-effective-client path.

## Ops notes

- The cookie is httpOnly so it won't show in `document.cookie` — debug via DevTools → Application → Cookies, or by checking `Set-Cookie` headers on the route handler response.
- Connection pool: every page in `(client)` calls `getActiveClient()`. The helper is wrapped in `react/cache` so layout + page + nested helpers dedupe to a single session/cookie/DB roundtrip per render. Removing the cache would re-introduce the EMAXCONNSESSION pool exhaustion we hit during the rollout.
