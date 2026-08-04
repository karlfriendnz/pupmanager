# Security audit — 2026-08-04

**Scope.** Local dev instance only (`localhost:7777`) plus the isolated e2e
instance. No production, no real customer data. Two throwaway trainer
businesses (A and B) and their clients were created for the work and removed
afterwards (`scripts/audit-sec-seed.ts` / `scripts/audit-sec-clean.ts`).

**What was probed.** Tenant isolation across every API route that takes an id
(pages *and* API), client-side isolation, mass assignment, price/money
integrity, XSS through the rich-text path, the auth surface (rate limiting,
password reset, sign-out, session revocation), the public/unauthenticated
surface, and the admin routes.

**Headline.** Tenant isolation is in genuinely good shape — this is a codebase
that has clearly been through several security passes, and the `:id` matrix came
back clean. The real findings are in **session lifecycle** (nothing revokes a
session) and **response shape** (one endpoint hands out a stored OAuth refresh
token to every staff member), plus a **regex HTML sanitizer that is bypassable**
on the email path.

Everything below is ranked by real-world consequence.

---

## Findings

### F1 — Nothing revokes a session: sign-out, password change and deactivation are all cosmetic — HIGH

`src/lib/auth.config.ts`

```ts
session: { strategy: 'jwt', maxAge: 365 * 24 * 60 * 60 },
```

Sessions are stateless JWTs valid for a **year**, with no server-side session
store and no token-version claim. `auth()` decodes the cookie and never asks the
database whether the account is still entitled to it. Three consequences, all
verified against the local instance:

**(a) Signing out does not invalidate the token.**

```
POST /api/auth/signout          → 302   (cookie cleared in the browser)
GET  /api/clients   Cookie: <the pre-signout cookie>
                                → 200 {"items":[{"id":"…","name":"Audit Client B", …}]}
```

The cookie is only removed from the browser. A copy captured beforehand — from
a shared machine, a synced browser profile, a proxy log, an XSS — keeps working.

**(b) Rotating the password does not invalidate the token.**

```
(rotate Account.providerAccountId for the credentials provider)
GET  /api/clients   Cookie: <session minted before the change>   → 200
```

"Change your password because you think someone got in" does not get them out.

**(c) Admin deactivation does not lock the account out, and undoes itself.**

```
(set User.deactivatedAt = now — what /admin/trainers "Deactivate" does)
GET  /api/clients   → 200  (full client list)
GET  /dashboard     → 200  (renders)
```

`deactivatedAt` is not read anywhere on the request path — `grep -rn
deactivatedAt src/app src/lib` returns only admin listings, the cron purge, the
public `/c/[slug]/join` filter, and the write itself. Worse, the NextAuth
`signIn` callback calls `reactivateOnSignIn()` (`src/lib/reactivate-account.ts`),
which **clears `deactivatedAt` on any successful sign-in**. So an account an
admin deactivated re-enables itself the next time the person logs in, and never
reaches the 30-day `purge-deactivated` cutoff either.

That reactivate-on-return behaviour is a deliberate, sensible product decision
for a *self*-deactivated account. It is the wrong behaviour for an *admin*
deactivation, and the two share one flag.

**Why it matters.** This is the control a trainer reaches for when something has
gone wrong, and the control PupManager reaches for when a customer account has
to be stopped. Neither works. With payment data (Stripe Connect, invoices,
client PII) behind the session, a year-long unrevokable token is a long time.

**Smallest fix.** Add `sessionsValidFrom` (or `tokenVersion`) to `User`; stamp it
on sign-out-everywhere, password reset, and deactivate; compare it in the `jwt`
callback (which already does a DB read for trainer context on some paths).
Separately, give admin deactivation its own flag that `reactivateOnSignIn` does
not clear, and check it in `authorize()` *and* the layouts. Also consider
dropping `maxAge` from 365 days to something a person would recognise.

**Test:** `tests/e2e/audit-security.spec.ts` → *security audit — session
revocation* (3 tests, marked `test.fail` so they go green on the fix).

---

### F2 — `GET /api/trainer/profile` returns the entire row, including a live Google OAuth refresh token — MEDIUM-HIGH

`src/app/api/trainer/profile/route.ts`

```ts
export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') { … }
  const profile = await prisma.trainerProfile.findUnique({
    where: { id: session.user.trainerId ?? '' },
  })                                   // ← no `select`
  return NextResponse.json(profile)
}
```

Verified response keys include:

```
googleCalendarRefreshToken, stripeCustomerId, stripeSubscriptionId,
connectAccountId, terminalLocationId, resendDomainId, sandboxBilling,
isInternal, isFounder, gracePeriodUntil, conversionLikelihood, seatCount,
promoCodeId, baseAddress/baseLat/baseLng, …
```

Two separate problems:

1. **`googleCalendarRefreshToken` is a credential.** A Google refresh token is
   long-lived and exchangeable for calendar access outside the app. It is
   returned in a JSON body to the browser of anyone signed into the business.
2. **No permission gate on the GET.** The PATCH is behind
   `guardPermission('settings.edit')`; the GET is behind nothing but "is a
   TRAINER in this company". A **STAFF** member with no settings permission gets
   the whole row: billing state, Connect ids, internal scoring
   (`conversionLikelihood`), the owner's home address (`baseAddress`/lat/lng).

**Why it matters.** Multi-trainer businesses are a shipped feature and STAFF is
explicitly the "sees only what's assigned to them" role. This endpoint hands
that role the company's secrets. It is one `select` away from correct.

**Fix.** Add an explicit `select` listing only what the settings screen renders,
and gate the GET on `settings.view` (or at minimum keep secrets out regardless
of role).

**Test:** `tests/e2e/audit-security.spec.ts` → *security audit — trainer profile
response shape* (marked `test.fail`).

---

### F3 — `sanitizeEmailHtml` is bypassable: it only recognises whitespace-delimited attributes — MEDIUM

`src/lib/email-html.ts`

The event-handler strip is three regexes that all require whitespace before the
handler:

```ts
.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
```

HTML parsers accept `/` (and comment-ish junk) as an attribute separator just as
happily. Verified against the live function:

| Payload | `sanitizeEmailHtml` output |
|---|---|
| `<img src=x onerror=alert(1)>` | `<img src=x>` ✅ stripped |
| `<img/src=x/onerror=alert(1)>` | **unchanged** ❌ |
| `<img src=x/**/onerror=alert(1)>` | **unchanged** ❌ |
| `<details/open/ontoggle=alert(1)>` | **unchanged** ❌ (`details` is not in the drop list) |
| `<button formaction=javascript:alert(1)>` | **unchanged** ❌ (only `href`/`src` are scheme-checked) |

**Where it lands.** `emailBodyToHtml()` wraps this function, and its output is
rendered with `dangerouslySetInnerHTML` in:

- `src/app/(trainer)/enquiries/[id]/page.tsx:222` — the stored reply thread
- `src/app/(trainer)/settings/email-templates-panel.tsx:507` — template preview
- `src/app/(admin)/admin/announcements/announcements-manager.tsx:45`
- `src/app/(admin)/admin/onboarding-emails/onboarding-emails-view.tsx` (×3)

…and is **sent as live HTML mail** by `client-email.ts` (trainer → client
broadcasts), `client-invite-email.ts`, `enquiries.ts`, `form-auto-reply.ts`,
`announcement-email.ts`, `onboarding/send-emails.ts`, `trainer-notify.ts`.

**Severity.** Every authoring path is trainer- or admin-authenticated, so this
is not "any visitor XSSes a trainer". The realistic impact is (a) self-XSS /
stored XSS confined to the author's own screens, (b) HTML injection into
outbound mail, and (c) — the one that would actually hurt — an **admin**
announcement body reaching the admin panel of another admin. It is nonetheless
the declared XSS boundary for that content and it does not hold.

`AGENTS.md` already says *"Do not reuse the regex `sanitizeEmailHtml`
(admin-only) for trainer content."* It is being reused for trainer content
(enquiry replies, client broadcasts, invite templates).

**Fix.** Replace the regex pass with a `sanitize-html` allowlist, the way
`sanitizeRichHtml` already does. The style-inlining step can stay.

**Test:** `tests/unit/security/audit-sanitizer-bypass.test.ts` — four `it.skip`
cases assert the correct behaviour (un-skip on the fix) plus a live test that
pins the current bypass so it cannot be forgotten.

---

### F4 — Outbound email interpolates `logoUrl` into an `<img src>` unescaped — LOW

`src/app/api/enquiries/[id]/reply/route.ts` (and the same shape in several other
email builders):

```ts
`<img src="${logoUrl}" alt="${safeBusiness}" … />`
```

`businessName` is escaped (`safeBusiness`); `logoUrl` is not. A trainer who sets
`logoUrl` to `x" onerror="…` injects markup into every email their business
sends. Self-inflicted and email-client-mitigated, but the neighbouring value is
escaped so this reads as an oversight rather than a decision. `emailAccentColor`
in the same file *is* re-validated at send time with a hex regex — do the same
for the URL.

---

## Verified good — the things that correctly refused

These were actively attacked and held. They are the more useful half of this
report: they are now pinned by tests so they stay held.

### Tenant isolation across the `:id` surface

Signed in as trainer B, pointed at trainer A's rows. **Every one refused with a
404** (a few 403), and re-reading the database afterwards showed **nothing
written** — no rename, no delete, no planted row.

Covered: clients (detail/dogs/field-values/location/notify/packages/
achievements/reinvite/share/product-requests), dogs (detail/media/photo),
sessions (detail/attachments/form-responses/linked-fields/series-step/
default-homework/time-entries/polish/buddies), packages (detail/clone/
session-plans/default-homework/comms-flow), products (detail/clone/stock/
variants/categories), class runs (detail/enrollments/convert/comms-flow),
memberships (detail/invites/comms-flow), forms (unified/embed/session-form),
library (types/themes/tasks/clone/assign), homework tasks (detail/complete/
logs), receivables (detail/record-payment/send/request-payment), tags, custom
fields, achievements, email templates, enquiries (detail/accept/decline/reply),
waitlist, discounts, locations, booking pages, availability, blackouts, comms
templates, training templates, time rates, todos.

The pattern is consistent and deliberate: routes resolve with
`findFirst({ where: { id, trainerId } })` (or `getClientAccess` /
`accessibleSessionWhere` / `getGroupAccess`) and 404 rather than 403, so a
foreign id looks like it does not exist. That is the right call.

**Two documented 200s, both empty and both correct:**

- `GET /api/sessions/:id/series-step` → `{"isSeries":false,"pinnable":false,"step":null,"steps":[]}`
- `GET /api/sessions/:id/default-homework` → `{"packageId":null,"sessionIndex":null,"tasks":[],"recipients":[]}`

Both routes scope by `trainerId` internally and return an empty payload rather
than a 404 so the screen renders nothing instead of erroring — the source says
so explicitly ("an empty payload says so without leaking which"). No foreign
data is present in either. The e2e spec asserts the payloads really are empty
rather than blanket-allowing the 200.

### Mass assignment

Every write route validates with a Zod object schema, which strips unknown keys
rather than passing them to Prisma. Attempted and refused:

| Body sent | Result |
|---|---|
| `PATCH /api/user {role:"ADMIN", isAdmin:true, emailVerified:…}` | role unchanged |
| `PATCH /api/trainer/profile {subscriptionStatus, stripeSubscriptionId, tapToPayEnabled, isInternal, connectChargesEnabled, seatCount, gracePeriodUntil, sandboxBilling, isFounder, acceptPaymentsEnabled}` | every field unchanged |
| `POST /api/products {trainerId: <rival>}` | ignored; row lands in the caller's own business |
| `POST /api/packages {trainerId: <rival>}` | ignored |
| `POST /api/tags {trainerId: <rival>}` | ignored |

There is no `...body` spread, no `.passthrough()`, and no `data: body` anywhere
in `src/app/api/**/route.ts`.

### Money integrity

`POST /api/my/basket/checkout` and `POST /api/my/products/:id/buy` take
*choices*, never amounts — the route comment says so and the code matches. Every
price is re-read from the row via `resolveVariantPricing` /
`effectivePriceCents`; a `priceCents` or `unitAmount` in the body is not in the
schema and is discarded. Quantity is `z.number().int().min(1).max(MAX_*)`, so
negative, zero and absurd quantities are rejected at parse time. A `productId`
belonging to another trainer 404s (`product.trainerId !== profile.trainerId`).
Stock is checked before checkout and decremented on settlement. A trainer in
client-preview mode is refused outright so a preview can never charge a card.

### The rich-text XSS boundary (`sanitizeRichHtml`)

This is the one that matters — trainer-authored descriptions render to clients
and to the public. It is a `sanitize-html` allowlist and it held against 30
payloads including `javascript:`/`vbscript:`/`data:` URLs (plain, mixed-case and
entity-obfuscated), `<script>`, `<img onerror>` in every delimiter form,
`<svg onload>`, `<iframe srcdoc>`, `<body onload>`, `<details ontoggle>`,
`<form><button formaction>`, `<base>`, `<link>`, `<style>` exfiltration,
`style="expression()"`, and nested `<scr<script>ipt>`. Links come out with
`rel="noopener noreferrer nofollow" target="_blank"` forced. Legacy plain-text
descriptions are HTML-escaped before conversion, so `<img src=x onerror=…>`
typed into an old textarea renders as text.

### Admin surface

All 23 files under `src/app/api/admin/**` carry a role check. A normal trainer
and a client were both refused on trainers/announcements/plans/promo-codes/
trainer-notes/trainer-tasks/demo-reset/demo-seed/addons/onboarding-steps/
billing-items and on `/api/admin/impersonate/:trainerId`. The proxy
(`src/proxy.ts`) additionally bounces non-admins off `/admin` pages, and the
routes enforce it again server-side — belt and braces, correctly.

### Auth surface

- **Login rate limit exists and is honest.** `src/lib/auth.ts` calls
  `isRateLimited('login:<ip>', 30, 15min)` *before* looking the user up, and
  returns `null` when over — so a correct password after the cap is refused, not
  quietly let through. Env-overridable (`LOGIN_RATE_LIMIT_MAX`) for the e2e
  suite only.
- **Password reset tokens** are 256-bit `crypto.randomBytes(32)`, expire in one
  hour, are matched against the email they were issued for, and are **deleted in
  the same transaction** as the password write — so a link cannot be replayed.
  `forgot-password` always returns `{ok:true}`, so it does not enumerate
  accounts.
- **Rate limits are on every unauthenticated/expensive endpoint** I looked for:
  register, signup, signup-client, forgot-password, reset-password,
  set-password, set-email, resend-verification, public form submit, form
  continue, `/api/pay/:token/checkout`, account delete, bulk email, message
  groups, AI summarise/polish, product buy, class enrol, basket checkout,
  membership request. The limiter is a single atomic Postgres upsert and
  **fails open** on a DB error — a deliberate, documented trade-off (availability
  over strict enforcement); worth knowing, not a finding.
- **Org switching is verified server-side.** The `jwt` `update` trigger only
  switches `trainerId` if the user actually holds a `TrainerMembership` for the
  requested company.
- **Privilege escalation inside a business is blocked.** `/api/trainer/team/:id`
  refuses to touch the OWNER, refuses MANAGER→MANAGER management, and a
  non-OWNER cannot grant a permission they do not themselves hold.

### Client-side isolation

`getActiveClient()` resolves the acting client from
`ClientProfile.findFirst({ where: { id: activeId, userId: session.user.id } })` —
the `pm-active-trainer` cookie is a *filter*, never a source of truth, so
forging it selects nothing rather than selecting someone else. The preview
cookie is scoped the same way (`{ id: previewId, trainerId: session.user.trainerId }`),
so a trainer can only preview their own clients. Middleware role routing is
explicitly documented as a *hint*, with the real check re-derived from the DB in
the layouts — and that is what the code does.

### Message groups

Every group route goes through `getGroupAccess()`, which requires either
membership of the owning business *with* `messages.send`, or a live participant
row; a participant who has left keeps nothing; an unaccepted COMMUNITY invite
sees the invitation, not the conversation or the other members. Cross-business
group ids 404.

---

## Coverage — what I could *not* test

Being honest about the edges:

- **Stripe webhook signature verification** was read, not exercised — I did not
  forge signed events, and no live Stripe keys were used. Same for the Xero and
  Resend webhooks.
- **Tap-to-Pay / Terminal** routes were not exercised (they need real Stripe
  Terminal state).
- **Google Calendar OAuth callback** (`/api/google-calendar/callback`) was not
  exercised — no live Google credentials. The `state` parameter handling
  deserves a look for CSRF on the connect flow.
- **Native/Apple sign-in path** (`/api/auth/apple-native`) was not exercised —
  it bypasses NextAuth by design (see memory), which makes it the highest-value
  remaining target. Recommend a focused pass.
- **File upload routes** (`/api/upload/image`, `/api/upload/video`,
  `/api/library/upload`, the video-upload routes) were not exercised for content
  type/size/SSRF — Vercel Blob is not wired locally.
- **The dev server was shared with five concurrent audit agents** and spent long
  stretches unresponsive under Turbopack recompiles. The API matrix was run
  against it with retries; the authoritative, repeatable version of the same
  matrix is now the e2e spec, which runs against the isolated embedded-Postgres
  instance.
- **SSE/streaming routes** (`/api/messages/stream`, `/api/notifications/stream`,
  `/api/message-groups/:id/stream`) were checked for access control by reading,
  not by holding connections open.
- No **load, timing-attack or crypto** analysis was attempted.

---

## Tests added

| File | What it pins |
|---|---|
| `tests/e2e/audit-security.spec.ts` | The exhaustive cross-tenant matrix over every `:id` route (≈125 probes in one test) + a DB check that nothing was written; client→foreign-business refusals; client on trainer API; price/quantity tampering; mass assignment (role, billing, `trainerId`); the admin surface for both trainer and client; impersonation; and the three failing session-revocation tests + the failing profile-shape test |
| `tests/unit/security/audit-sanitizer-bypass.test.ts` | The four `sanitizeEmailHtml` bypasses (asserting the fix, skipped, plus a live pin of the current behaviour) and 30 payloads against `sanitizeRichHtml`, checked tag-by-tag rather than by substring |

The cross-tenant matrix is written to **enumerate**: the victim business comes
from one `victimFixtures()` factory and the probe list is data, so a new
`/api/**/[id]` route is one line to cover forever.

Failing-by-design tests use `test.fail(true, '…')` / `it.skip` with the reason
inline, so the suite stays green for everyone else until the fixes land.
