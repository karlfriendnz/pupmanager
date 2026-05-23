# PupManager security + completeness scan — 2026-05-23

Full sweep of the codebase (134 API routes, pages, libs) for insecure patterns
and unfinished work. **Overall: the platform is in strong shape** — every
non-public route authenticates, tenancy is scoped, admin is gated, the Stripe
webhook and crons are protected, no secrets are exposed, and uploads are
size-capped server-side. The findings below are mostly hardening + a couple of
unfinished config items, not active holes.

## ✅ Verified solid
- **Auth coverage**: every API route authenticates. The only route without an `auth()` call is the Google Calendar OAuth callback — correct, because it validates a one-time, expiring CSRF `state` token bound to the initiating user instead (can't use the session cookie on a cross-site redirect).
- **Admin**: all `/api/admin/*` routes check `role === 'ADMIN'`; the `(admin)` layout + middleware gate the pages.
- **Multi-tenancy / IDOR**: management, client, session, booking, waitlist, product-request and device routes all scope by `trainerId` / `getClientAccess` / `session.user.id`. `getClientAccess` is membership-aware; `preview-as` verifies the client belongs to the trainer before setting the cookie (1h TTL).
- **Webhooks/crons**: Stripe webhook verifies the signature (503 if unconfigured); 6/7 crons require `CRON_SECRET` (the 7th is `keep-warm`, a parameterless `SELECT 1`).
- **Injection/XSS**: no `$queryRawUnsafe`/`$executeRawUnsafe`, no `dangerouslySetInnerHTML`, no `@ts-ignore`/`@ts-nocheck`.
- **Secrets**: no hardcoded keys; only `NEXT_PUBLIC_APP_URL` + `NEXT_PUBLIC_BUILD_ID` are client-exposed (both non-secret).
- **Uploads**: dog-photo + session-attachment uploads validate size **server-side** (`maximumSizeInBytes` on the Blob token — not bypassable) and verify ownership before issuing a token.
- **Auth flows**: `forgot-password` always returns success (no user enumeration); invited-member `createUser` won't hand a member their own business.

## Findings

### MEDIUM — No rate limiting anywhere
There is no throttling on any endpoint. Real exposure:
- **Login** (`authorize`) — password brute-force, no lockout/backoff.
- **Public form submit** (`/api/form/[id]/submit`) — unauthenticated; each call creates an Enquiry **and** fires an email + push to the trainer. Spammable → notification flooding, DB bloat, Resend/APNs cost.
- **register / forgot-password / resend-verification** — email-send spam.
- **AI routes** (`/api/ai/*`) — LLM cost (authed, so lower risk).

**Recommendation:** add rate limiting. Cleanest on this stack is Upstash Redis (`@upstash/ratelimit`) or Vercel KV, keyed by IP for public endpoints and by user for authed ones. Needs an infra choice — flagging rather than unilaterally adding a dependency.

### LOW — `keep-warm` cron is unauthenticated
`/api/cron/keep-warm` is in `PUBLIC_PATHS` and runs `SELECT 1` with no `CRON_SECRET`. Harmless (no data, no mutation) but publicly pingable. Optionally gate it like the others.

### LOW — `debug/client-log` accepts anonymous beacons + logs arbitrary payload
`/api/debug/client-log` does `auth().catch(() => null)` and `console.log`s `body.data` verbatim (no DB write). Log noise / minor log-injection. Consider requiring a session or dropping it in prod.

### INFO — Upload content-type intentionally unrestricted
Session-attachment uploads don't set `allowedContentTypes` (documented: iOS sends odd MIME types). Size + auth are enforced, but an authed trainer could store a non-media file on Blob. Very low risk (their own action, unguessable URLs).

### INFO — `preview-as` + Google Calendar scope to company/owner
`preview-as` lets any company trainer preview any company client (read-only) — not restricted to assigned clients. Google Calendar connect updates the profile by `userId`, so only the owner can connect a calendar. Both are by-design-acceptable but worth knowing for a strict multi-trainer model.

## Unfinished / completeness
- **LOW — Android App Links fingerprints are empty** (`/.well-known/assetlinks.json`): the `sha256_cert_fingerprints` array is placeholder-only, so Android deep links fall back to the browser instead of opening the native app. Fill from Play Console → App signing once published. (Documented as intentional-for-now.)
- **LOW — Onboarding "welcome video"** on the dashboard is a "Coming soon" placeholder.
- **LOW — Google Calendar connect** won't work for invited members (owner-only) — fine if calendar is treated as business-level.

## Fixed during this scan
- **Public form submit**: added max-length caps (name 120, email 200, phone 40, message 4000, custom-field values 2000) on the unauthenticated endpoint to prevent megabyte-payload DB bloat.

## Top recommendation
Add **rate limiting** (the one MEDIUM) before broad public exposure — login brute-force and public-form spam are the realistic abuse vectors for a live SaaS. Everything else is low/informational.
