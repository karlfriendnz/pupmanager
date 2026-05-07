# PupManager Self-Serve Onboarding — Brief

> **Status:** Phase 1 (schema + seed) shipped 2026-05-07. Phases 2–7 pending.
> **Owner:** Karl (build), Brooke (copy + trainer voice review).
> **Living doc:** update as decisions change. This is the source of truth for the onboarding initiative.

---

## Goal

A new trainer can sign up and reach the **aha moment — first real client registered** — without any human help from PupManager.

## Aha moment (precise definition)

A `User` with `role = 'client'` exists, is linked to this trainer's `TrainerProfile`, and has `lastSignInAt` populated. Sample-data clients (created by the demo system, see below) do not count.

- Invite-sent ≠ aha
- Account-created-but-never-opened ≠ aha
- Signed-in once = aha (real trust signal)

## Audience (v1)

- **Greenfield trainers** — solo, migrating from spreadsheets/notebook
- **Switchers** — coming from Gingr/DoTimely/etc., have existing client lists. Importer is a separate project owned by Karl; this flow does *not* branch on archetype in v1.

## Out of scope for v1

- In-app help docs CMS (link to external help center for now)
- A/B testing of step copy
- Multi-language onboarding
- Anything tied to features that don't exist yet (payments, group classes, vax compliance)
- Step 0 ("new vs switching") branching — dropped from earlier draft

---

## Trainer journey

```
SIGNUP
  ↓ (auto-create sample client + DEFAULT_ACHIEVEMENTS on first dashboard load)
MODAL WIZARD  — 7 steps, all skippable, soft warnings only
  Step 1  Business profile               (name, logo, phone)
  Step 2  Publish your intake form       (template chooser)
  Step 3  Set up your session form       (template chooser + key fields)
  Step 4  Add a program/package          (optional, not aha-blocking)
  Step 5  Pick your achievements         (preview seeded defaults, keep/edit)
  Step 6  See it from your client's side (demo data preview — Sarah & Bailey)
  Step 7  Invite your first client       ← aha trigger armed
  ↓
DASHBOARD
  - "Setup checklist" widget — skipped steps stay listed, completed ✓
  - "Waiting for [client] to register" limbo card while step 7 pending
  - "Resume setup" reopens the modal at the next incomplete step
  ↓
DRIP EMAILS  (Resend, behavior-based — see below)
  ↓
🎉 First client registers → checklist auto-dismisses, celebration toast
```

## Skip behavior

- Every modal step has a "Skip for now" secondary button alongside the primary CTA
- Skipping advances to the next step; skipped steps stay open in the dashboard checklist
- **Soft warnings** on impactful skips, never blocks. Examples:
  - Intake form skip: *"Without a published intake form, invited clients will have nowhere to register. Skip anyway?"*
  - Invite client skip: *"Without inviting your first client, you won't reach the moment PupManager actually starts saving you time. Skip anyway?"*
- Trainer can leave the modal at any time without losing progress; "Resume setup" reopens at the next incomplete step

---

## Demo data system

**On first dashboard load**, auto-create a sample client + dog tagged `isSampleData = true`, using the cast from `project_pup_cast.md`:

- Client: `Sarah Carter`
- Dog: `Bailey (sample)`
- Pre-populated: 3 past sessions, 1 progress note, 1 photo, 1 earned achievement, 1 submitted intake form

**Visibility:**
- Visible across the app so the trainer has *something* to look at while exploring
- Yellow banner: "Sample data — only you can see this" on every sample record
- Step 6 of the wizard launches `/preview-as/<sample_client_id>` (route already exists) so they experience the client app populated

**Cleanup:**
- One-click "Remove sample data" in Settings → Onboarding
- Auto-prompted to remove after their first 3 real clients register
- Never auto-deleted (some trainers like keeping it as a reference)

**Re: existing trainers** — only auto-create sample data for *new* signups. Existing trainers get a one-off "Generate sample data" button in settings, opt-in only.

---

## Drip emails

All six emails are seeded in `OnboardingEmail`. Cron job (Phase 4) evaluates `triggerRule` against each trainer's state hourly and dispatches via Resend, logging to `TrainerOnboardingEmailLog` for idempotency.

### Sender strategy

Two senders, replying to a shared inbox. Voice picked per email moment:

| # | Email | Sender | Why |
|---|---|---|---|
| 1 | Welcome | **Karl** | Origin story is his to tell |
| 2 | Day-1 nudge (business name) | Karl | Setup mechanics |
| 3 | Invite chase (24h) | **Brooke** | "I've sent this exact message to my own clients" |
| 4 | Try another channel (72h) | Brooke | Trainer practical wisdom |
| 5 | Founder check-in (7d, book a call) | Brooke | Fellow trainer = credible |
| 6 | Aha celebration | Brooke | Domain-side win, not a tech win |

Tradeoff flagged but accepted: managing two From identities in Resend, replies could land on either inbox. Worth it for credibility.

### Trigger rules

JSON shape (`OnboardingEmail.triggerRule`):

| Email key | Rule |
|---|---|
| `welcome` | `{ type: 'on_signup' }` |
| `nudge_business_name_24h` | `{ type: 'after_signup', hours: 24, requireStepIncomplete: 'business_profile' }` |
| `invite_chase_24h` | `{ type: 'after_first_invite_sent', hours: 24, requireNoClientSignedIn: true }` |
| `invite_other_channel_72h` | `{ type: 'after_first_invite_sent', hours: 72, requireNoClientSignedIn: true }` |
| `founder_check_in_7d` | `{ type: 'after_signup', hours: 168, requireAhaNotReached: true }` |
| `aha_celebration` | `{ type: 'on_aha_reached' }` |

### Drafted copy

Plain markdown stored in `OnboardingEmail.body`. Phase 4 swaps to React Email TSX templates. Founder origin story (Karl + Brooke) is the lead in Email 1. Real Karl + Brooke photo to be embedded in Email 1; inline screenshots in Emails 1, 5, 6 (per "lean on real photos" memory).

Full copy lives in `prisma/seed.ts` in the `ONBOARDING_EMAILS` constant.

---

## Data model (live)

Implemented in Phase 1. See `prisma/schema.prisma`:

```prisma
// Admin-editable content (CMS layer)
OnboardingStep       { key, order, title, body, ctaLabel, ctaHref, skippable, skipWarning, publishedAt }
OnboardingEmail      { key, subject, body, senderKey, triggerRule(JSON), publishedAt }

// Per-trainer state
TrainerOnboardingProgress         { trainerId, startedAt, ahaReachedAt, firstInviteSentAt, checklistDismissedAt }
TrainerOnboardingStepProgress     { progressId, stepKey, startedAt, completedAt, skippedAt }
TrainerOnboardingEmailLog         { progressId, emailKey, sentAt }   // unique → no resends
```

**Design choices:**

- `stepKey` and `emailKey` on the per-trainer rows are denormalised strings (no FK) so admins can rename/delete content keys without orphaning trainer history.
- `publishedAt` lets admins draft new content without exposing it to trainers.
- `senderKey` is a string (`"karl"` | `"brooke"`) not an enum — easier to extend if a third founder/staff joins.

### Default achievements

Seeded **per trainer** (not globally) on first dashboard load. Defined in `src/lib/achievement-defaults.ts`:

1. First Session (`FIRST_SESSION`)
2. 5 Sessions Together (`SESSIONS_COMPLETED`, 5)
3. First Homework Done (`FIRST_HOMEWORK_DONE`)
4. Perfect Week (`PERFECT_WEEK`, 1)
5. 1 Month Together (`CLIENT_ANNIVERSARY_DAYS`, 30)
6. Loose Leash Walking (`MANUAL`)

Mix shows new trainers all four trigger shapes (auto-firing, count-based, time-based, manual) without overwhelming.

---

## Admin CMS scope (`/admin/onboarding`)

Auth: existing `(admin)` route group already gates by `session.user.role === 'ADMIN'` (see `src/app/(admin)/layout.tsx:8`). New tab in `AdminTabNav`.

- **Steps** tab — list/reorder, edit copy, edit `skipWarning`, preview-as-trainer, publish/unpublish
- **Emails** tab — edit subject/body, edit `triggerRule` via guided form (not raw JSON), send test to self, see send count
- **Funnel** tab — for each step: started/completed/skipped + drop-off; for aha: median time-to-aha, signup→aha conversion

---

## Implementation phases

| # | Phase | Status | Notes |
|---|---|---|---|
| 1 | Schema + migration + seed default steps & emails | ✅ Done 2026-05-07 | Live in Supabase. Ran `prisma db push` (dev/prod share DB). |
| 2 | Modal wizard + dashboard checklist widget | ⏳ Next | Includes per-trainer init: `TrainerOnboardingProgress` + `DEFAULT_ACHIEVEMENTS` seed on first dashboard load. |
| 3 | Demo data system | Pending | Sample client/dog + auto-populate + cleanup. Possibly extend `prisma/seed-demo.ts` patterns. |
| 4 | Cron + Resend drip sender (HTML emails via React Email) | Pending | Hourly cron, evaluates `triggerRule` per trainer. Needs DNS for `brooke@pupmanager.com`. |
| 5 | Admin CMS for steps & emails | Pending | New `/admin/onboarding` route + tab. |
| 6 | Funnel analytics view | Pending | Read-only admin tab. |
| 7 | QA pass + iterate copy | Pending | Brooke reviews trainer voice; cross-client email rendering; dark-mode QA. |

---

## Things still flagged (open questions / risks)

- **Step 4 (program/package) is the weakest aha-relevant step.** Keep skippable, watch usage data; may move post-aha if drop-off is high.
- **Email sender domain** — confirm `karl@pupmanager.com` and `brooke@pupmanager.com` DNS is set up in Resend (SPF/DKIM/DMARC) before drips ship in Phase 4.
- **Step CTA hrefs in seed** are placeholders pointing at existing routes. Phase 2 may swap some for in-wizard subroutes.
- **Existing `/onboarding` stub page** at `src/app/(trainer)/onboarding/page.tsx` collects business profile and promises "Step 1 of 3" but only step 1 exists. Phase 2 needs to either repurpose this as the wizard entry or remove it. Probably remove — the modal wizard reads from DB and lives on the dashboard.
- **Existing trainers** — backfill `TrainerOnboardingProgress` on first post-deploy dashboard load but **do not auto-open the modal**. Show a one-time banner: *"Want to take the new setup tour?"* → opt-in only. New signups still get the modal automatically. (Decided 2026-05-07.)

---

## Companion docs / references

- `prisma/schema.prisma` — onboarding models (search "─── Onboarding")
- `prisma/seed.ts` — `ONBOARDING_STEPS` and `ONBOARDING_EMAILS` constants
- `prisma/migrations/20260507_add_onboarding_system/migration.sql`
- `src/lib/achievement-defaults.ts`
- `src/app/(admin)/layout.tsx` — admin auth gate
- `src/app/(trainer)/onboarding/` — existing stub to repurpose/remove

---

## Marketing / off-brief touchpoints (flagged for later)

The founder origin story (Karl + Brooke, "Sunday night reclaimed") should land:

- Landing page founder section with both photos and the Sunday-night story
- About page long-form origin
- Sales / cold outreach opening line
- Podcast pitches — "trainer + builder co-founder team" hook

Not part of this onboarding work — separate marketing initiative.
