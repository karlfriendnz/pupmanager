# Audit — the first-run journey (stranger → working trainer account)

Scope: public surface, all four signup paths, email verification, the
profile-completion gate, the personalisation wizard (all 7 personas, every
branch), and empty states on a brand-new account.

- Tested against **local dev on :7777** and the local dev DB `pupmanager_dev`.
  Never production.
- Harness lives in `tests/audit/signup/` (throwaway; the durable tests are in
  `tests/e2e/audit-signup.spec.ts`).
- Accounts created: `signupaudit.*`, `wizaudit.*`, `emptyaudit.*`,
  `dbg*@pupaudit.test`. The demo login was never touched.

Severity vocabulary: **breaks the journey / wrong data / confusing / cosmetic**.

---

## THE HEADLINE ANSWER: do the wizard's add-ons actually switch on?

**Yes — the mapping works. All 7 personas verified end to end.** The four review
notes saying "the add-ons don't end up on" are not reproducible as a mapping
bug. What *is* real is that the wizard's whole persistence layer is
fire-and-forget with every error swallowed, so on a slow/contended server it
silently loses writes — see **S-01**, which is almost certainly what was
actually being seen.

Driven with Playwright (`tests/audit/signup/03-wizard.ts`), one fresh account
per persona per mode, reading `trainer_addons` straight from the DB afterwards:

| Persona | Answers that claim an add-on | Add-on rows written |
|---|---|---|
| walker | software→Xero, team→yes, travel→yes, sell→yes | `routeplanner=true, shop=true, timesheets=true, xero=true` |
| trainer | software→Xero, team→yes, sell→yes, reward→yes | `achievements=true, shop=true, timesheets=true, xero=true` |
| behaviourist | same as trainer | `achievements=true, shop=true, timesheets=true, xero=true` |
| groomer | software→Xero, team→yes, travel→yes, sell→yes | `routeplanner=true, shop=true, timesheets=true, xero=true` |
| petsitter | software→Xero, team→yes, travel→yes, sell→yes | `routeplanner=true, shop=true, timesheets=true, xero=true` |
| puppyschool | software→Xero, team→yes, sell→yes, reward→yes | `achievements=true, shop=true, timesheets=true, xero=true` |
| other | software→Xero, team→yes, sell→yes | `shop=true, timesheets=true, xero=true` |

And the negative direction (every question answered to switch things OFF) wrote
the explicit `false` rows for the default-on core add-ons, for all 7 personas:

```
classes=false, clientapp=false, notes=false
```

`classes` is inferred from the offerings picked, and that inference is correct:
ticking *Group classes* / *Puppy courses* leaves `classes` on (no row → default
on); ticking only 1:1-style offerings writes `classes=false`.

`landingPage` seeding is also correct: walker/groomer/petsitter → `schedule`,
trainer/behaviourist/puppyschool/other → `dashboard`.

So the wiring is sound. The problem is that nothing checks it landed.

---

## Findings

### S-01 — The wizard's saves are fire-and-forget; a failed save is invisible and the wizard comes back forever
**Severity: breaks the journey**

`src/app/(trainer)/dashboard/personalization-wizard.tsx` swallows every error on
every write it makes:

- `persistAddons()` — `fetch('/api/addons', …).catch(() => {})` per add-on
- `saveProfile()` — `fetch('/api/trainer/profile', …).catch(() => {})`
- `persistLandingView()` — `fetch('/api/user', …).catch(() => {})`

and `onComplete()` in `onboarding-panel.tsx` does:

```ts
setWelcomeDismissedLocal(true)          // hide it locally FIRST
await Promise.all([
  fetch('/api/onboarding/tour/start',    { method: 'POST' }),
  fetch('/api/onboarding/welcome/dismiss',{ method: 'POST' }),
])                                       // ← a 404/500 resolves normally
```

A `fetch` resolves on a 404 or a 500. Nothing inspects `res.ok`. So when a write
fails the trainer is told nothing, the modal closes anyway, and the answers are
gone.

**Reproduction (observed, not theoretical).** During the 14-run persona sweep the
dev server was under load from concurrent work. `POST /api/onboarding/tour/start`
and `POST /api/onboarding/welcome/dismiss` both returned **404**, silently. Result:

```
select u.email, o."welcomeShownAt", o."backfilledAt",
       o."checklistDismissedAt", o."ahaReachedAt"
  from users u
  join trainer_profiles p on p."userId" = u.id
  left join trainer_onboarding_progress o on o."trainerId" = p.id
 where u.email like 'wizaudit.%';
```

→ **14 of 14 accounts that completed the whole wizard have all four gate columns
NULL.** `shouldShowWelcome()` (`src/lib/onboarding/welcome.ts`) returns true when
all four are null, so **the personalisation wizard reopens on the next dashboard
load, and every load after that**. The trainer has no way out except finishing it
again and hoping the write lands.

The same run showed the add-on POSTs partially landing (one account got its rows,
another got none) — same cause, same silence.

The 404 itself is most likely a Turbopack dev-server artifact under load, and I
am not claiming production returns 404 on those routes. **The finding is that it
does not matter why the write failed** — the UI cannot tell, does not retry, and
does not say. On a flaky mobile connection this is a trainer who redoes their
onboarding every single time they open the app.

**What should happen:** check `res.ok`; retry or surface a real error; do not
dismiss the modal locally until the server has confirmed. `welcomeShownAt` in
particular should be stamped before, or atomically with, closing the wizard.

---

### S-02 — `/api/auth/verify-email` has no rate limit at all
**Severity: wrong data (security)**

Every other sensitive auth route is throttled (`register` 5/hr, `signup` 5/hr,
`resend-verification` 5/hr, `set-password` 10/hr, `login` 30/15min). The one that
checks a **6-digit** secret is not.

**Reproduction:** 30 wrong codes for a known email from a single IP, all 400, none
throttled, in **949 ms** (`tests/audit/signup/01-api.ts`, `VER brute-force limited`).

That is ~1,900 guesses/minute from one IP, unbounded, against a 1,000,000-value
space with a 10-minute validity window. A successful guess does more than verify
an address: for a `/register` lead it mints the `pwsetup:` token, and
`POST /api/auth/set-password` then **creates the credentials account** — i.e. full
takeover of a brand-new trainer account before its owner has set a password.

**What should happen:** `enforceRateLimit` on the route, keyed on both IP and
`identifier`, e.g. 10 attempts per email per hour, matching the sibling routes.

---

### S-03 — "Other" trainers can never be offered the route planner or achievements
**Severity: confusing**

In `src/lib/onboarding-recommendations.ts`:

- the `travel` question (→ `routeplanner`) is `roles: ['walker','petsitter','groomer']`
- the `reward` question (→ `achievements`) is `roles: ['trainer','behaviourist','puppyschool']`

A trainer who picks **Other** matches neither, so the wizard never asks either
question and can never switch either add-on on. Confirmed: the `other` persona's
run shows only `shop`, `timesheets`, `xero`.

Someone whose trade is not on the list is exactly the person most likely to
travel to clients. **What should happen:** show both questions to `other`, or
drop the `roles` filter on them.

---

### S-04 — Personas and offerings that have a matching add-on don't switch it on
**Severity: confusing**

The add-on catalog (`src/lib/pricing.ts`) contains `puppyschool`, `dropins`,
`events`, `memberships`, `library` and `payments`. The wizard maps to none of them:

| Wizard answer | Add-on that exists | Switched on? |
|---|---|---|
| Line of work = **Puppy school** | `puppyschool` | no |
| Offering = **Drop-in visits** (walker) | `dropins` | no |
| "How would you like to take payments?" = **Online / card payments** | `payments` | no |

The payments question maps to nothing at all — the code comments say it is
"profiling only", but a `payments` add-on does exist, so answering "online
payments" and then finding payments not enabled is a reasonable surprise.

A trainer who says *"I run a puppy school"* does not get the Puppy school
feature. **What should happen:** decide deliberately per add-on; if these are
intentionally left off, say so in the wizard rather than leaving the answer inert.

---

### S-05 — `defaultAnswers()` is dead code and one of its values is invalid
**Severity: cosmetic (latent)**

`defaultAnswers()` (`onboarding-recommendations.ts`) is exported but never used —
the wizard starts from `useState<WizAnswers>({})` with the comment "Nothing is
pre-selected". Inside it, `clientapp: 'yes'` is not one of that question's option
ids (`'app' | 'email' | 'none'`). If anyone ever wires the pre-fills up, that
question will render with nothing selected while `coreAddonState` still reads it
as "on". Worth deleting or fixing now rather than discovering later.

---

### S-06 — "Where do you see your clients?" is multi-select but its options are mutually exclusive
**Severity: confusing**

The `travel` question is `multi: true` with the options *"I travel to them"* and
*"They come to me"*. Both can be ticked at once, and both ticked is the same as
just the first (the add-on is unioned). Every other yes/no question in the flow
is single-select with radio styling; this one shows checkboxes for what reads as
an either/or. Either make it single-select, or add a third "both" option and mean it.

---

### S-07 — No length cap on the name field; 5,000 characters is stored verbatim
**Severity: cosmetic**

`POST /api/auth/register` with a 5,000-character `name` returns **201** and stores
all 5,000 characters (`select length(name) → 5000`). `name` has a `min(2)` and no
`max`. The same is true of `businessName`. It renders in the app header, in client
emails, and on the booking page. Every other free-text field in these routes is
capped (`phone` is `max(30)`, `promoCode` `max(40)`).

**What should happen:** a `.max()` on `name` and `businessName` in both
`/api/auth/register` and `/api/auth/signup` (and the same on
`/api/trainer/complete-profile`, which has the same gap).

---

## Verified working — no action needed

These were tested and behaved correctly. They are the half worth pinning with
tests, and are covered in `tests/e2e/audit-signup.spec.ts`.

**Public surface.** `/`, `/welcome`, `/login`, `/register`, `/signup`,
`/signup/client`, `/forgot-password`, `/reset-password`, `/verify-account`,
`/verify-email`, `/logout`, `/invite` all render signed-out (200).
`/find-trainer` correctly bounces to `/login?callbackUrl=…` — it is gated, not public.

**Signup validation** — both paths reject: empty body, name/business under 2
chars, malformed email, phone under 6 chars, a bad ISO country code, an unknown
promo code (with a specific message, not a silent default), a duplicate email
(409), and a password under 8 characters. Both accept a phone typed as
`(09) 555 1234` and a `+`-addressed email.

**Trial length** — `/register` and `/signup` both stamp exactly **10 days**
(`trialEndsAt - now() = 10.00 days`, `subscriptionStatus = TRIALING`) and record
`signupCountry`. A valid promo code overrides the length; an invalid one blocks
signup rather than silently falling back.

**Email verification** — a 6-digit OTP is issued with a 10-minute expiry, and:

| Case | Result |
|---|---|
| wrong code | 400, generic message |
| non-numeric code | 400 |
| correct code | 200, `needsPassword=true`, mints a setup token |
| same code reused | 400 — the token is deleted in the same transaction |
| expired code | 400 "That code has expired", user stays unverified, row cleaned up |
| setup token tampered | 400 |
| **another account's setup token** | 400 — the token is checked against `pwsetup:<email>` |
| setup token reused | 400 — burned on use |

**No user enumeration** on `/api/auth/resend-verification` or
`/api/auth/forgot-password` — byte-identical `{"ok":true}` for a known and an
unknown address.

**A `/register` lead cannot log in until it sets a password** — the route
deliberately creates no `Account` row, so the account is a contactable lead with
no way in. Confirmed: 0 credential accounts after verification.

**Rate limiting on `/api/auth/register`** — 429 on the 6th attempt from one IP
(limit 5/hour), as designed.

**The profile-completion gate** (`(trainer)/layout.tsx`) is correctly built:
it keys on the profile the user *owns* (so invited staff are unaffected),
exempts `/complete-profile` itself so it cannot loop, is skipped under admin
impersonation, and `CompleteProfileFrame` renders with no nav and no way out but
completing the form or signing out. `/complete-profile` re-checks server-side and
redirects to `/dashboard` if already complete, so the URL cannot be used to
linger. `POST /api/trainer/complete-profile` re-validates and writes only the
caller's own profile.

**The wizard's per-persona tailoring** is correct in every branch:
offerings shown are the union of the chosen roles; the travel question appears
only for walker/petsitter/groomer; the reward question only for
trainer/behaviourist/puppyschool; the Xero follow-up only appears under
"Accounting software" and only Xero (not Hnry/QuickBooks/Stripe) enables the
add-on; `businessRoles` is persisted for all 7 personas.

---

## What I could NOT test, and why

- **Google OAuth end to end.** No test Google credentials, and the flow leaves
  the app for accounts.google.com. I read the path instead: an OAuth signup
  creates a profile with an empty `businessName` and no `signupCountry`, which is
  precisely what the profile-completion gate exists to catch, and
  `/api/trainer/complete-profile` backfills the country. Not executed.
- **The native Apple path** (`/api/auth/apple-native`). It bypasses NextAuth and
  needs a real Apple identity token; there is no way to mint one locally. Read
  only. Note that private-relay addresses are handled separately — the trainer
  layout redirects them to `/verify-account?relay=1` and
  `resend-verification` refuses to send to them, both of which look right.
- **Actual email delivery.** No Resend key in dev; `sendVerificationEmail`
  failures are caught and logged. I read the OTP from the DB instead, so the
  *link/code in the email* was never clicked as a user would. The magic
  sign-in link (`signIn('resend')`) is untested for the same reason.
- **Whether the 404s in S-01 occur in production.** They were seen on a
  contended Turbopack dev server. The finding stands on the missing error
  handling, not on the 404.
- **Empty states on every screen** — sweep in progress at the time of this
  commit; results appended below.
