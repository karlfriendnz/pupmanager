# UX audit — how PupManager looks and feels, on a phone and on a desktop

**Date:** 2026-08-04 · **Scope:** every trainer screen and every client screen at
390px (phone), 760px (narrow desktop window) and 1440px (desktop).
**Method:** own Playwright driver (`tests/audit/ux-lib.ts`, `ux-sweep.ts`,
`ux-sweep-client.ts`) against the local dev server on 7777, signed in as a
throwaway trainer seeded by `tests/audit/setup-ux.ts` — a 60-character business
name, three clients, a three-dog household, a 40-session class and mixed-width
invoices — plus a second, brand-new empty trainer for empty states, and a client
login for the client app. The demo login was not touched.

Judged against **`AGENTS.md` → "Mobile-first look"** first, and the
`ui-ux-pro-max` skill second. Where they disagree, `AGENTS.md` won.

**This is a report. Nothing was fixed** — five agents were working at once and
concurrent edits would have collided. What *was* added is
`tests/e2e/audit-ux.spec.ts`, which pins the mechanical rules so they stop
rotting: no horizontal overflow at any width, one scrollbar with an overlay
open, visible focus.

Severity: **unusable** · **hard to use** · **off-style** · **nitpick**.

---

## The short version

**Good news first, because it is real:**

1. **Nothing overflows horizontally.** 42 trainer routes at 1440 and 31 at 390 —
   every `document.scrollWidth` matched the viewport, on every one. The
   60-character business name, the 40-session class and the long invoice titles
   all truncate rather than shove. This is the rule that usually rots first and
   it is clean.
   Touch targets are clean too: the `min-height/min-width: 44px` rule in
   `globals.css` holds everywhere, with the only sub-40px control being a
   `role="switch"` toggle, which that stylesheet exempts on purpose.
2. **Safe areas are handled properly** — `env(safe-area-inset-*)` in the shell,
   the phone header, the bottom tabs and the create sheet, plus `--app-safe-top`
   on the desktop bar so an iPad on the desktop layout still clears the notch.
3. **The overlay scrollbar rule has a real safety net** in `globals.css`
   (`body:has(.pm-overlay) { overflow: hidden }` plus rail-hiding inside
   `.pm-overlay` and `[role=dialog][aria-modal]`). It works — where components
   opt into it.

**The bad news is concentrated in three places**, in the order Karl cares about:

- The **first screen a new trainer ever sees** (the dashboard welcome modal) is
  the single most machine-made surface in the product, and it scrolls the page
  behind itself.
- **Icons render at the wrong weight almost everywhere** — `strokeWidth={1.75}`
  is the house rule, but on the dashboard 48 icons render at 2 and only 9 at
  1.75. This is why screens read heavier than the style intends.
- **Seven overlays opt out of the scrollbar safety net**, so opening them puts
  two scrollbars on screen — Karl's standing "never, ever" rule.

---

## Findings, worst first

### 1. The new-trainer welcome modal is the most machine-made screen in the app — and it scrolls the page behind it
**Screen:** `/dashboard`, brand-new account · **Width:** 390 and 1440 ·
**Severity: hard to use** (and the worst first impression in the product)
**Rules broken:** 1 (flat surfaces), 2 (no decorative colour), 3 (colour is the
trainer's), 7 (never two scrollbars)

`src/app/(trainer)/dashboard/onboarding-panel.tsx:248` and `:350` are two
full-screen overlays that:

- paint a **blue → indigo → violet gradient** hero (`:251`) with four decorative
  paw watermarks — *"a tinted icon tile is the single clearest tell of a
  machine-made screen"*, and a gradient band is the louder version of it;
- use **PupManager blue/indigo, not the trainer's accent** — the whole point of
  rule 3;
- put a **gradient CTA button with a hover-lift** (`:292`);
- ship a **play button for a video that does not exist** ("Coming soon",
  "Welcome video · 90 seconds"). A new trainer taps play and nothing happens;
- carry **no body-scroll lock, no `.pm-overlay` marker and no
  `role="dialog" aria-modal="true"`**. So the dashboard scrolls behind the
  modal — two scrollbars — and keyboard focus is never trapped.

A third gradient icon tile lives at `:362` (`h-12 w-12 rounded-2xl
bg-gradient-to-br from-blue-600 to-indigo-600`), and `:316` is a
`from-blue-50 to-violet-50` band.

*Fix shape:* flat white card, one bordered block, hairline dividers, drop the
fake video, tint with `var(--pm-brand-600)` / the trainer's accent, and add
`pm-overlay` to the two `fixed inset-0` roots so the stylesheet's net catches
them.

---

### 2. Seven overlays put a second scrollbar on screen
**Screen:** several · **Width:** all, worst at 390 · **Severity: hard to use**
**Rule broken:** 7 — *"Never two scrollbars on screen. Ever."*

`globals.css` has the net: `body:has(.pm-overlay) { overflow: hidden }` plus
rail-hiding for `.pm-overlay` and `[role=dialog][aria-modal=true]` subtrees.
These portal to `<body>` and opt into **neither**, and none of them locks body
scroll in JS either:

| File | Line | What it is |
|---|---|---|
| `src/app/(trainer)/dashboard/onboarding-panel.tsx` | 248, 350 | new-trainer welcome + guided setup |
| `src/app/(trainer)/clients/[clientId]/assign-package-modal.tsx` | 293–295 | assign a package (`max-h-[90vh] overflow-y-auto`) |
| `src/app/(trainer)/clients/quick-add-contact.tsx` | 157–158 | quick-add a contact (`max-h-[90dvh] overflow-y-auto`) |
| `src/components/shared/add-location-modal.tsx` | 52–53 | add a location (`max-h-[90dvh] overflow-y-auto`) |
| `src/components/shared/recurrence-field.tsx` | 133–134 | repeat rules (`max-h-[90dvh] overflow-y-auto`) |
| `src/app/(trainer)/clients/[clientId]/share-client-modal.tsx` | 89 | share a client |

The four with `overflow-y-auto` are the visible ones: the sheet scrolls, the
page scrolls behind it, and neither region carries `no-scrollbar`. Note the
below-md rule in `globals.css` keys off **viewport** width, so this is visible on
a narrow desktop window (760×560) as well as on a phone.

*Fix shape:* one class. Add `pm-overlay` to each `fixed inset-0` root and the
existing stylesheet does the rest. While there, give them
`role="dialog" aria-modal="true"` — none of the six is an accessible dialog
today.

---

### 3. Icons render at stroke-width 2 nearly everywhere, not 1.75
**Screen:** every trainer screen · **Width:** all · **Severity: off-style**
**Rule broken:** 2 — *"Plain line icons, `strokeWidth={1.75}`"*

Measured stroke widths of every rendered `<svg>`:

| Screen | at 2 (lucide default) | at 1.75 (house rule) | width |
|---|---|---|---|
| `/dashboard` | 46 | 9 | 390 |
| `/schedule` | 43 | 2 | 390 |
| `/clients` | 39 | 2 | 390 |
| `/packages` | 42 | 2 | 390 |
| `/doggy-daycare` | 43 | 2 | 390 |
| `/dashboard` | 48 | 9 | 1440 |
| `/schedule` | 39 | 2 | 1440 |

Measured on the phone layout *and* the desktop layout — it is the same ratio on
both, so it is the call sites, not a shell that only loads heavy icons on one.

The source has `strokeWidth={1.75}` in 403 places, so the rule is known — but
the nav rail, the top bar, the list rows and most inline icons simply omit the
prop and inherit lucide's default 2. The net effect is that the whole product
reads heavier and busier than the style it is written to. Fixing this is one of
the highest look-per-effort changes available: set the default once (a wrapper,
or `strokeWidth={1.75}` on a shared `<Icon>`), rather than 400 more call sites.

---

### 4. `/awards` is a decorative-colour screen from top to bottom
**Screen:** `/awards` · **Width:** 390 and 1440 · **Severity: off-style**
**Rules broken:** 1, 2, 3

`src/app/(trainer)/awards/page.tsx:63` — an **orange → rose gradient hero**
(`linear-gradient(135deg,#fb923c,#f97316,#f43f5e)`) with a
`shadow-[0_12px_40px_-12px_rgba(234,88,12,0.45)]` glow, two decorative paw
watermarks, a `text-5xl font-black` number and a `bg-white/20 backdrop-blur`
icon tile. Below it the probe found **10 tinted icon tiles and 9 sibling cards
each carrying its own shadow** — the exact "stack of floating cards" rule 1
forbids. None of the colour is the trainer's.

---

### 5. Floating card stacks instead of one bordered block
**Severity: off-style** · **Rule broken:** 1

Sibling elements that each carry their own `box-shadow`, measured at 1440:

| Screen | Stacks |
|---|---|
| `/awards` | 9 shadowed siblings |
| `/reports` | 4 + 5 shadowed siblings |
| `/add-ons` | 5 shadowed sibling buttons |
| `/ai-tools` | 2 shadowed siblings |

Rule 1 wants these as ONE `rounded-xl border border-slate-200 bg-white` block
split by 1px lines. `src/components/shared/flat-list.tsx` already has the
primitives (`FlatBlock`, `FlatRow`) — these four screens predate or bypass them.

---

### 6. Tinted icon tiles painted with the raw brand hex
**Screen:** `/help`, `/dashboard`, `/enquiries`, `/packages`,
`/casual-classes`, `/memberships`, `/instagram` · **Severity: off-style**
**Rules broken:** 2, 3

`src/app/(trainer)/help/help-center.tsx:217` renders six
`h-10 w-10 rounded-xl` tiles filled with `var(--pm-brand-600)` — solid
`rgb(42,157,169)`, a white icon inside. That is the shape AGENTS.md names as
the single clearest tell of a machine-made screen, and it is painted with the
**raw** brand value rather than a `color-mix` derivation.

The empty states on `/enquiries`, `/packages`, `/casual-classes` and
`/memberships` each carry the same pattern at `h-10`–`h-12`. Four screens, one
component's worth of work.

---

### 7. Every trainer screen ships two `<h1>`s, and two of them are wrong
**Screen:** all · **Severity: nitpick** (structure) / **off-style** (dashboard)
**Rules broken:** 6 (nothing says the same thing twice), a11y heading order

Every trainer route renders the page title as `<h1>` twice — once in the desktop
top bar and once in the phone bar. One is `display:none` at any given width, so
a screen reader sees one, but it is still two h1s in the DOM and `/schedule`
manages three. The ones that genuinely bite:

- **`/notifications`** has an **empty `<h1>`** (`""`) plus the business name plus
  "Notifications" — three h1s, one of them announcing nothing.
- **`/dashboard`** has "Good morning, Uma 👋" *and* the 60-character business
  name as h1s. Rule 6: the bar above already carries the business identity.
- **Heading level jumps** (h1 → h3, skipping h2) on `/schedule`
  ("Sync your Google Calendar"), `/finances` ("Get paid in the app") and
  `/reports` ("New clients per month").

Also: the dashboard greeting uses an emoji (👋) as decoration — the skill's
`no-emoji-icons` rule, and it is the only emoji in the trainer chrome.

---

### 8. Form fields with no label — worst on Settings
**Screen:** `/settings` (and every screen that embeds the settings panels:
`/website`, `/add-ons`, `/finances/stripe`) · **Severity: hard to use** for
anyone on a screen reader, **off-style** otherwise
**Rules broken:** a11y `form-labels`; also AGENTS.md's own *"Name your sections
and fields — a `<label>` on a field is what the capture reads"*

15 controls on `/settings` have **no `<label for>`, no `aria-label`, no wrapping
label** — only a placeholder, or nothing at all:

- "Search your base address…" (address autocomplete)
- the **country** `<select>`, the **timezone** `<select>`, the default-landing-page `<select>`
- three `input[type=file]` (logo, icon, brand image)
- the brand-colour hex field (`#2a9da9`)
- daycare: name, **two bare `input[type=time]`**, price, limit, and a bare `input[type=date]`

A bare `<input type="time">` with no label is unusable by voice control and
opaque to a screen reader. It also means the in-app review widget cannot name
the field when Karl pins a comment on it, which is the second cost.

**`/doggy-daycare` has 7 more** on the same pattern — the daycare name, the
day-part name, two bare `input[type=time]`, price, limit and a bare
`input[type=date]`.

Smaller instances: `/clients` search, `/finances` two search boxes,
`/ai-tools` (client select, goal textarea, duration select), `/timesheets`
(rate name + rate value), `/marketing/new` (template select, subject),
`/dashboard` and `/sessions/needs-notes` ("Add a to-do…", the brain-dump
textarea), `/instagram` (file input).

Confirmed identical at 390 and 1440 — this is markup, not a responsive branch.

---

### 9. Five buttons on `/reports` are all announced "View data"
**Screen:** `/reports` · **Severity: hard to use** on a screen reader ·
**Rule broken:** a11y `aria-labels`

`src/app/(trainer)/reports/reports-explorer.tsx:405` — every chart card gets a
"View data" button with no chart name in its accessible name. A screen-reader
user hears "View data, button" five times and cannot tell which chart they are
about to open. This is the same class of defect as the known "two buttons both
announced Create".

Same pattern, less severe: two "New category" buttons on `/library` and
`/templates`, two "Add link" on `/instagram`, two "Notifications" on `/settings`,
`/website`, `/add-ons` and `/finances/stripe`.

*Fix shape:* `aria-label={`View data for ${chart.title}`}`.

---

### 10. The trial banner is a shimmering gradient pill that sits on top of the "+" button
**Screen:** every trainer screen while trialing · **Width:** 390 ·
**Severity: hard to use** (collision) / **off-style** (colour)
**Rules broken:** 2, 3

`src/app/(trainer)/trial-banner.tsx:122–124` gives the floating banner three
gradient tones — `from-blue-600 via-indigo-600 to-violet-600`,
`from-rose-500 via-pink-500 to-fuchsia-500`,
`from-red-600 via-rose-600 to-rose-700` — each with
`animate-pm-trial-shimmer`, a 40px drop shadow and a hover-lift. None of it is
the trainer's colour, and it is on **every screen** for the whole trial.

Geometry, at 390: the banner is `fixed right-2.5 bottom-[5.625rem]` (90px) and
the global create button is `fixed right-4` at `bottom: calc(4.5rem + safe)`
(72px+) and 56px tall — so the two occupy overlapping space in the
bottom-right corner. On a trialing account the trial pill lands on or beside
the "+" a trainer is trying to hit. Worth eyeballing on a real trial account;
the numbers say they collide.

---

### 11. The desktop rail makes `md:` fire at the wrong time — this is the container-query rule
**Screen:** every offerings screen (`/packages`, `/classes`,
`/casual-classes`, `/memberships`, `/achievements`, `/offerings/tags`) ·
**Width:** 768–1100 · **Severity: off-style**
**Rule broken:** 9 (container queries, not viewport queries)

`src/components/shared/offering-card.tsx:616` is explicit about it:

```
: 'grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
```

The rail appears at `md` (768px) and is `md:w-64` (256px), so at a 768px window
the content column is **~512px** — and that is exactly where `md:grid-cols-2`
starts putting two wordy offering cards side by side, at ~250px each. This is
the same geometry that once crushed the offering card's title.

Repo-wide the ratio tells the story: **8 container-query variants** (`@sm:`,
`@xl:`, `@2xl:`, `@3xl:`) against **~950 viewport variants** (431 `sm:`,
392 `md:`, 125 `lg:`). Only four files use `@container` at all —
`clients-list.tsx`, `booking-wizard.tsx`, `offering-card.tsx`,
`browse-shell.tsx`. Every page that renders inside the 17rem rail and uses a
`md:`/`lg:` grid is measuring the wrong box.

*Fix shape:* make the trainer `<main>` a query container once, then the
`columns === 4` branch's `@sm/@xl/@3xl` pattern becomes usable everywhere and
the `columns` prop disappears.

---

### 12. The client app treats desktop as an afterthought
**Screen:** all `/my-*` and `/home` · **Width:** 1440 · **Severity: off-style**

`src/app/(client)/home/home-view.tsx:245` caps every client screen at
`md:max-w-3xl md:mx-auto` (768px) inside a shell that already spends 256px on a
rail (`app-shell.tsx:517`, `md:ml-64`). At 1440 that leaves a 768px phone
column floating in ~200px of white on each side. It is not broken, but it reads
as "the phone screen, on a monitor" rather than a designed desktop view — and
a dog owner opening the app on a laptop is a normal case.

Related: the client shell's nav hint dot is
`bg-indigo-500 animate-pm-menu-dot` (`app-shell.tsx:499`, `:576`, `:1385`) —
a pulsing indigo dot in a shell that is white-labelled to the trainer's brand.
Rule 3: that dot should be the trainer's accent or neutral.

---

### 13. Empty states are hand-rolled 30+ times over
**Screen:** everywhere · **Severity: off-style**

There is no shared empty-state primitive. `flat-list.tsx` exports `FlatBlock`,
`FlatRow`, `FlatTileGrid`, `FlatTile`, `SectionLabel` — and nothing for "there
is nothing here yet". The result is 30+ separately written variants
("No clients yet", "No achievements yet", "No achievements set up yet",
"No achievements have been set up yet" — three phrasings of one idea), each
with its own icon tile, its own spacing and its own tone.

On a brand-new account this is what the trainer sees on every screen, so the
inconsistency is concentrated exactly where first impressions are made.

---

### 14. Two tables can push their own page sideways
**Severity: nitpick** (no overflow observed at the widths tested, but the
containers are missing)

`<table>` with no `overflow-x-auto` ancestor:

- `src/app/(trainer)/reports/reports-explorer.tsx:460` — the "View data" modal's table
- `src/app/(client)/my-profile/client-notification-settings.tsx:92`
- `src/app/pay/[token]/invoice-detail.tsx`, `src/components/finances/receivable-document.tsx`
- admin: `billing-health/page.tsx`, `trainers/trainer-row.tsx`

They fit today because their columns are short. A longer invoice description or
a longer notification-type name and the page body scrolls sideways, which is the
failure mode the rule exists to prevent. Cheap insurance: wrap each in
`<div className="overflow-x-auto">`.

---

### 15. `--accent-strong` mixes toward black, not `#0f172a`
**Severity: nitpick** · **Rule broken:** 3

`globals.css:268`: `--accent-strong: color-mix(in oklab, var(--accent), black 14%)`.
AGENTS.md says *"derive tones with `color-mix` toward `#0f172a`"* — mixing
toward pure black desaturates a pastel brand rather than deepening it. The
neighbouring `--accent-soft`/`--accent-tint`/`--surface` all mix toward white,
which is correct.

---

## What is pinned in CI

`tests/e2e/audit-ux.spec.ts` (new, mine alone) asserts the mechanical rules that
rot silently:

1. **No horizontal overflow** on 13 trainer screens at 390 / 760 / 1440, and 5
   client screens at 390 / 1440 — with the offending element named in the
   failure message.
2. **One scrollbar with the phone create sheet open** — body scroll is locked,
   and no scrolling region inside the overlay renders a visible rail.
3. **Focus is visible** on the login form and on the first control of
   `/settings`.

Deliberately not pinned: colour, gradients, stroke weight, card stacking. Those
are taste calls and belong in this document, not in a test that would fight the
next redesign.

## How to reproduce

```
npx dotenv -e .env.development.local -o -- npx tsx tests/audit/setup-ux.ts
npx tsx tests/audit/ux-sweep.ts trainer      # → tests/audit/out/ux-trainer.json
npx tsx tests/audit/ux-sweep-client.ts       # → tests/audit/out/ux-client.json
```

Both sweeps are additive against the local dev DB and never touch the demo
login. `tests/audit/ux-lib.ts` carries the probe (overflow, scrollers,
gradients, tinted tiles, shadow stacks, stroke widths, touch targets, labels,
heading order) and its own storage-state files so it can run alongside other
agents' sessions.
