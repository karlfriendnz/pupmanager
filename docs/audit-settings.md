# Settings / forms / fields audit — 2026-08-04

Scope: every setting, every tab, every field, every toggle, the form builder,
offering + product forms, and validation. Method: own Playwright driver
(`tests/audit/`, ad-hoc config `tests/audit/playwright.audit.config.ts`) against
**local dev on :7777**, own throwaway trainer (`audit.settings@pupaudit.test`,
created by `tests/audit/setup-trainer.ts` on the local `pupmanager_dev` DB).
The demo login was never touched. Nothing in `src/` or `prisma/` was changed.

Regression tests promoted out of this audit live in
`tests/e2e/audit-settings.spec.ts`.

**Severity key:** `loses data` > `wrong behaviour` > `confusing` > `cosmetic`.

---

## Verified WORKING (no bug)

These were changed, saved, **reloaded**, and confirmed to have persisted.

### Settings → Details
| Field | Result |
|---|---|
| Your name | persists (PATCH `/api/user`) |
| Business name | persists |
| Phone number | persists |
| Show my phone number to clients | persists |
| Business email (`publicEmail`) | persists |
| Country (`signupCountry`) | persists |
| Base currency | persists — saves instantly on change, no Save press needed |
| Timezone | persists |
| "When you open the app, start on" (landingPage) | persists |
| What your business offers (persona chips) | persists |

Validation on this form is correct:
- Empty required fields → "Your name is required" / "Business name is required" /
  "Phone number is required", nothing is sent.
- Invalid business email → "Enter a valid email", nothing is sent.
- HTML / emoji / RTL text (`<script>alert(1)</script> Ünïcode 🐶 مرحبا`) round-trips
  intact and is escaped on render — **no XSS**.

### Settings → Notifications
- All **36** channel checkboxes (12 notification types × in-app/phone/email)
  flip → save → survive a reload, and flip back cleanly. PUT
  `/api/notification-preferences` returns 200 for each.
- "Customise" row: *Minutes before* select, custom *Title*, custom *Body* all
  persist across a reload.

### Settings → Configure (the 13 free feature switches)
Each of the 13 switches was flipped **individually**, reloaded, verified, and
flipped back — **all 13 persist**: 1:1 sessions, Casual classes, Group classes,
Events, Packages, Messaging, Timesheets, To-do & brain dump, Session notes,
Training library, Xero, Google Calendar, Instagram.

### Add-on gating — the switch really does gate the feature
Toggled via `POST /api/addons` and re-read the left nav. On → the entry appears;
off → it goes:

| Feature | Nav entry it gates |
|---|---|
| messaging | `/messages` Messages |
| library | `/library` Library |
| timesheets | `/timesheets` Timesheets |
| events | `/events` Events |
| memberships | `/memberships` Packages |
| classes | `/classes` Group Classes |
| dropins | `/casual-classes` Casual Classes |
| onetoone | `/packages` 1:1 Sessions |
| instagram | `/instagram` Instagram link |
| achievements | `/achievements` Achievements |
| shop | `/products` Products |
| marketing | `/marketing` Marketing |
| routeplanner | `/schedule/route` Route |
| googlecalendar | Settings → Calendar tab |

---

## Findings

(see the numbered entries below — each has repro, expected, severity)

