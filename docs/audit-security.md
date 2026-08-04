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

### F4 — A client can be shared or transferred to another business with nobody's consent, and the share can never be revoked — MEDIUM

`src/app/api/clients/[clientId]/share/route.ts`

The route is correctly authorised — `guardPermission('clients.invite')` plus
`findFirst({ where: { id: clientId, trainerId: guard.companyId } })`, so a
trainer can only share a client they own, and my cross-tenant probe was refused.
The problem is what a *legitimate* call does:

```ts
await prisma.clientShare.create({
  data: { clientId, sharedById: guard.companyId, sharedWithId: partnerProfileId, shareType },
})
if (shareType === 'TRANSFER') {
  await prisma.clientProfile.update({ where: { id: client.id }, data: { trainerId: partnerProfileId } })
}
```

Three things follow:

1. **The dog owner is never asked.** Their whole record — contact details, dog,
   session history, notes, invoices — becomes readable by a different business
   the instant a trainer types an email address. `TRANSFER` moves the record
   outright. The client is not notified; only the receiving trainer is.
2. **The receiving business is never asked either.** It receives another
   controller's personal data unsolicited.
3. **There is no revoke.** `grep -rn clientShare src/app src/lib` finds exactly
   one `create` and one `deleteMany` — and that `deleteMany` is inside
   `/api/admin/trainers/[trainerId]` account deletion. No trainer-facing route,
   no UI. A share, once made, is permanent; `getClientAccess()` keeps honouring
   it forever.

**Why it matters.** PupManager's stated posture (see the repo's jurisdiction
notes) has to satisfy GDPR, CCPA and the Australian APPs as well as the NZ
Privacy Act. "One user can hand another controller a data subject's full record,
irrevocably, without informing the subject" is the shape of a complaint, not a
bug report. It is also the only permission grant in the app with no off switch.

**Fix.** A `DELETE /api/clients/:id/share/:shareId` for the sharing business (and
ideally for the receiving one too), an `acceptedAt` on `ClientShare` so the
partner opts in, and a notification to the client. `TRANSFER` in particular
should require the receiving business to accept before `trainerId` moves.

**Test:** `tests/e2e/audit-security.spec.ts` → *a share can be withdrawn*
(marked `test.fail` — there is no route to call).

---

### F5 — 20 of 21 cron routes compare the Bearer token against `"Bearer undefined"` — MEDIUM (conditional)

Every cron route is gated like this:

```ts
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
}
```

When `CRON_SECRET` is unset, the template literal evaluates to the string
`"Bearer undefined"` — and anyone who sends exactly that header is in. Only
`src/app/api/cron/purge-deactivated/route.ts` gets it right:

```ts
if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) { … }
```

The other 20 do not. `/api/cron` is also in `PUBLIC_PATHS` in `src/proxy.ts`
(correctly — the routes authenticate themselves), so there is no second layer.

**What an attacker would get** in an environment missing the variable: mass email
and push to every trainer and client (`daily-reminders`, `session-reminders`,
`client-session-reminders`, `daily-summary`, `weekly-summary`,
`onboarding-emails`, `comms-flows`, `message-email-fallback`,
`enquiry-followups`), billing and membership reconciliation, Stripe/Xero state
mutation, Google Calendar backfills, and `purge-deactivated` (the one that is
guarded — luckily the destructive one).

**Confirmed not exploitable on this dev instance** — `CRON_SECRET` *is* set in
`.env`, so `Authorization: Bearer undefined` correctly returns 401. This is a
hardening finding: the failure mode is a missing env var, not a bad comparison
today. It is worth taking seriously because this repo has already had one
CRON_SECRET rotation go wrong (11 jobs, some missed, silent 401s), and because a
preview deployment or a new environment is exactly where a var goes missing.

**Note:** `/api/cron/keep-warm` is deliberately unauthenticated. It runs
`SELECT 1` and returns `{ok:true}` — nothing to protect, though it is an
open endpoint that touches the database.

**Fix.** One line, twenty times: `if (!process.env.CRON_SECRET || …)`. Better,
extract the check into a `requireCronSecret(req)` helper the way
`requireSameOrigin` already works, so a new cron route cannot get it wrong.

**Test:** `tests/unit/security/audit-cron-auth.test.ts` — enumerates the cron
directory rather than listing routes, so a cron route added later is covered on
the day it lands.

---

### F6 — Four of the seven app cookies are set without `secure` — LOW

| Cookie | Set in | `httpOnly` | `sameSite` | `secure` |
|---|---|---|---|---|
| `pm-preview-client` | `preview-as/[clientId]/route.ts` | ✅ | lax | **missing** |
| `pm-preview-client` | `(trainer)/products/[productId]/preview/route.ts` | ✅ | lax | **missing** |
| `pm-active-trainer` | `switch-trainer/[clientId]/route.ts` | ✅ | lax | **missing** |
| `pm-active-trainer` | `api/form/[formId]/continue/route.ts` | ✅ | lax | **missing** |
| `pm-profile-side` | `api/profile/switch`, `api/profile/choose` | ✅ | lax | ✅ |
| (session cookie) | `lib/session-cookie.ts` | ✅ | lax | ✅ |

Severity is low because none of these is a credential — every one is
re-verified server-side against the signed-in user on each request
(`getActiveClient()` re-filters by `userId`; the preview cookie is re-filtered by
`trainerId`), and the app is HTTPS-only in production. But `secure` costs
nothing and two of the four grant a *view* (`pm-preview-client` is the trainer
looking at a client's app), so they should not travel over plain HTTP on a
misconfigured host or a stray `http://` link. `PROFILE_COOKIE` already does it
right — copy that line.

---

### F7 — Outbound email interpolates `logoUrl` into an `<img src>` unescaped — LOW

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

**121 probes, signed in as trainer B, every one pointed at a row owned by
trainer A. Result: 107 refused outright (404, a few 403), 12 refused on a second
pass with a valid body, 2 answered 200 with a provably empty payload. Zero
leaks, and re-reading the database afterwards showed nothing written — no
rename, no delete, no planted row.**

The 12 that first came back `400 Invalid input` or `405` were my malformed
bodies, not a defence. Re-sent with schema-valid payloads they all 404'd:
`clients/:id/location`, `clients/:id/share`, `schedule/:id/buddies`,
`sessions/:id/series-step`, `products/:id/clone`, `products/categories/:id`,
`tags/assign` (PUT ×2 + GET), `receivables/:id` PATCH, and
`receivables/:id/record-payment`.

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

**Query-string tenant overrides are ignored.** Appending `?trainerId=<rival>` to
`/api/clients`, `/api/packages` and `/api/schedule/report` returns 200 — with the
*caller's own* data. The param is not read; the tenant comes from the session
context (`getTrainerContext().companyId`) in every case. `/api/schedule/report`
additionally refuses a staff member without `schedule.viewAll` with a 403, so
company-wide financials are not reachable from a restricted seat. Same for
`?clientId=<foreign>` on `/api/messages` (404) and
`/api/messages/unread-count` (200, `{"count":0}`).

**Reorder endpoints silently no-op on foreign ids.** `POST
/api/custom-fields/reorder` with another business's field id returns
`{"ok":true}` — but the write is `updateMany({ where: { id, trainerId } })`, so
zero rows match. Verified in the database afterwards: both fields still
`order: 0`, unchanged. It is safe; it just answers 200 where its siblings
(`/api/products/reorder`, `/api/tags/reorder`) answer 404. Worth aligning so the
"silently did nothing" case can't be mistaken for success.

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

**And the delivery side matches.** Every `dangerouslySetInnerHTML` in the repo
is on a trainer-admin *email preview* surface (listed under F3). There is not
one on a client page or a public page: `src/app/(client)/**`, `src/app/c/**`,
`src/app/l/**` and `src/app/form/**` render every description, intro and
homework body through `<RichText>` or `richTextToPlain`. So the payloads above
have nowhere to land even if one were stored.

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

### Webhooks

All three inbound webhooks fail **closed** and verify properly, which is the
pattern the cron routes should copy:

- `/api/webhooks/stripe` and `/api/webhooks/stripe/connect` — 503 when no
  secret is configured, 400 with no `stripe-signature`, verified against the raw
  body, dual live/sandbox secret candidates.
- `/api/webhooks/resend` — 503 with no `RESEND_WEBHOOK_SECRET`, Svix signature.
- `/api/xero/webhook` — HMAC-SHA256 of the raw body compared with
  `crypto.timingSafeEqual`, length-checked first.

### Public / unauthenticated surface

- `/api/auth/signup-client` creates a login **and nothing else** — no
  `ClientProfile`, because a client list is the trainer's business record. It
  raises an `Enquiry` the trainer approves. It explicitly refuses to attach a
  password to an existing `User` (the comment names account takeover as the
  reason), so a client their trainer already added cannot be hijacked by anyone
  who knows the address.
- `/api/form/:id/submit` is length-capped on every field and rate-limited per IP;
  it snapshots only the custom fields actually enabled on the form.
- Open-redirect: `safeInternalPath()` decodes once, then rejects anything that
  is not a single-leading-slash relative path — no `//host`, no `/\`, no
  backslashes, no scheme.
- CSRF: `requireSameOrigin()` validates `Origin` (falling back to `Referer`) on
  the money / account-deletion / role-change routes, and deliberately allows a
  *missing* Origin for the Capacitor webview — which is the correct trade-off,
  since a cross-site attacker's browser always sends one.

## Smaller observations (not findings)

- **`/api/cron/keep-warm` is unauthenticated** and runs `SELECT 1` on every
  call. Harmless content, but it is an open endpoint that touches the database.
- **Account enumeration on client signup.** `POST /api/auth/signup-client`
  returns a distinct "there is already an account for this email" error, so the
  endpoint confirms whether an address is registered. Mitigated by the 5/hour/IP
  rate limit, and the alternative (a silent success) is worse UX for a dog owner
  who genuinely forgot. Worth knowing it is a deliberate trade.
- **Ten routes still resolve the tenant with the legacy owner-only lookup**
  `prisma.trainerProfile.findUnique({ where: { userId } })` instead of
  `guard.companyId` — achievements (×2), library types/tasks/themes,
  embed-forms, custom-fields (×3), and the admin addons route. They fail
  **closed** (an invited MANAGER gets 403, so it is a functional bug rather than
  a hole), but it is exactly the drift that turns into a hole when someone
  "fixes" the 403 by deleting the scope instead of switching to `guard.companyId`.
- **`POST /api/custom-fields/reorder` answers 200 on a foreign id** where its
  five sibling reorder routes answer 404. It writes nothing (verified), but the
  inconsistency makes "silently did nothing" look like success.

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
