<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AT THE START OF EVERY SESSION — arm the review watch

Karl directs work through the in-app review widget: he pins comments on the real
screens, ticks the ones he wants built, and clicks **"Send ticked notes to
Claude"**, which writes `docs/review-tasks.md`. **Nothing in the browser can wake a
CLI**, so watch that file yourself, at the start of every session, with a
background Bash command:

```
f=docs/review-tasks.md; prev=""; [ -f "$f" ] && prev=$(md5 -q "$f"); while true; do sleep 3; cur=""; [ -f "$f" ] && cur=$(md5 -q "$f"); if [ -n "$cur" ] && [ "$cur" != "$prev" ]; then n=$(grep -c '^### ' "$f"); echo "NEW REVIEW TASKS: docs/review-tasks.md updated — $n task(s) sent."; prev="$cur"; fi; done
```

Run it with `run_in_background: true` and a description of "new review tasks". When
it reports, **read the brief** and follow the instructions inside it — which are:

1. **Triage first.** Tell Karl in one short list which items you understand and
   which you don't. He would much rather answer three questions up front than
   review three wrong changes. Don't start until he replies.
2. **Then one at a time**, in the order he agrees. Mark each item off before
   starting the next — the point of marking is that he checks it while you build
   the following one. Never batch a dozen changes and report at the end.
3. **Mark it back** with a PATCH to the URL the brief names (it stamps the port
   the app is actually on — don't assume 7777):
   `{"claudeStatus":"done","claudeNote":"what changed, one line"}`. This does NOT
   resolve the comment; a chip appears against it and Karl signs it off himself.
4. **Anything you can't place — ASK**, don't guess:
   `{"claudeStatus":"needs_info","claudeNote":"the question, one line"}`. A change
   to the wrong element is worse than an unactioned note, and this puts the
   question on the comment where he'll see it.

**Read the screenshots.** A note with an image is a note whose detail is IN the
image. The brief cites them as repo-relative paths (`public/review-uploads/…`)
precisely so you can open them with Read.

## Helping the widget point at the right thing

A comment is only as useful as the ability to find what it points at. Two cheap
habits make every future pin land:

**1. Say which view you're on** — put `data-review-scope` on any container that
swaps content, so a pin records which tab or step it was made on. Without it every
view of a tabbed screen piles onto one indistinguishable page key.

```tsx
<div data-review-scope={`Tab: ${activeTab}`}>
<div data-review-scope={`Step ${i + 1} of ${steps.length} · ${step.label}`}>
```

**2. Name your sections and fields** — a real `<h2>`/`<h3>` on a card and a
`<label>` on a field are what the capture reads. They are also just correct HTML,
so this costs nothing.

The capture, the page key and the brief generator are shared with fm-events —
`review-core` (https://github.com/karlfriendnz/review-core). Fix a capture rule
THERE, not here, or the two apps drift.


# PupManager repo layout

This repo holds the main app (`app.pupmanager.com`). The marketing site
(`pupmanager.com`) lives in its own repo at `karlfriendnz/pupmanager-marketing`,
cloned locally at `/Users/karl/pupmanager-marketing/`.

| Path | What | Dev command |
|------|------|-------------|
| `src/`, `prisma/`, `public/` | Main app — app.pupmanager.com (Next.js + Prisma + NextAuth) | `npm run dev` (port 3000) |
| `android/`, `ios/` | Capacitor mobile shells | Don't touch unless push-notification code changed |
| `branding/` | Logos, marketing assets, customer profile, voice rules — shared by app + marketing | — |
| `prisma/` | Schema, migrations, seeds | — |

## Deploys

- **Main app** (`app.pupmanager.com`): Vercel project `pupmanager-app`, watches `pupmanager-app.git` remote, root `.`.
- **Marketing site** (`pupmanager.com`): separate repo + Vercel project — see `/Users/karl/pupmanager-marketing/AGENTS.md`.
- Both auto-deploy on push to `main`. **Never `git push` without the literal phrase "Deploy Live"** from Karl (rule tightened 2026-05-12).

## Mobile-first look — flat, quiet, and the trainer's colour (global rule)

Mobile is the primary layout, not a squeezed desktop. Every screen is designed
at 390px first, then allowed to spread. The house style, in order of how often
it gets broken:

- **Flat surfaces, hairline dividers.** Related things live in ONE bordered
  block (`rounded-xl border border-slate-200 bg-white`) split by 1px lines —
  never a stack of floating cards with their own shadows.
- **No decorative colour.** No gradient bands, no tinted rounded chips behind
  icons. Plain line icons, `strokeWidth={1.75}`, `text-slate-700`. A tinted
  icon tile is the single clearest tell of a machine-made screen.
- **Colour is the trainer's, and it's rationed.** Their brand accent
  (`emailAccentColor`) tints icons and at most one attention strip; everything
  else stays neutral. Derive tones with `color-mix` toward `#0f172a` so a
  pastel brand stays legible — never paint with the raw hex.
- **Aggregate, don't fragment.** One "N things to review" row that opens, not
  a strip per kind.
- **Full screens, not dropdowns.** Create, search and anything with more than
  ~3 choices takes the whole screen: a title row, a way out, room to explain
  each option. A 56px menu hanging off a corner is not a phone UI. Portal it
  to `<body>` (`ModalPortal`) — the mobile header uses `backdrop-blur`, and a
  filtered ancestor becomes the containing block for `position: fixed`.
- **Nothing says the same thing twice.** No logo in the bar above a logo on the
  page; no subtitle restating the tabs' counts; no page-level add button beside
  the global "+".
- **Chrome earns its space.** Back replaces the menu on detail screens. The
  five bottom tabs are places a trainer works, never a menu.
- **One layout per component.** A `variant` prop that reflows a component two
  different ways is how the offering card ended up crushing its title on a
  phone. Let the CONTAINER be responsive; keep the component itself fixed.
- **Never two scrollbars on screen. Ever.** (Karl's standing rule.) A panel
  that scrolls while the page scrolls behind it is two, and it reads as a
  broken window. Any overlay — modal, sheet, full screen — MUST lock body
  scroll for as long as it's open (`document.body.style.overflow = 'hidden'`
  in an effect, restored on close), and its own scrolling region carries
  `no-scrollbar`. Don't rely on the below-md rule in globals.css for this: it
  keys off VIEWPORT width, so a narrow desktop window still shows rails.

Shared primitives live in `src/components/shared/flat-list.tsx`
(`FlatBlock`, `FlatRow`, `FlatTileGrid`, `FlatTile`, `SectionLabel`). Use them
rather than re-deriving the border/divider classes per screen.

## Rich text — descriptions are Tiptap HTML (global rule)

Every "description" (and long-form intro/bio/notes) field is **rich text**, not a
plain `<textarea>`. One editor, one renderer, one sanitizer — never hand-roll.

- **Input:** `RichTextEditor` (`src/components/shared/rich-text-editor.tsx`) —
  controlled (`value` / `onChange(html)`), emits constrained HTML (h2/h3, bold,
  italic, lists, links). Remount with a `key` when the underlying doc changes.
- **Display:** `<RichText html={…} />` (`src/components/shared/rich-text.tsx`).
  **Never** `dangerouslySetInnerHTML` a description yourself — this component
  sanitizes first and applies the shared `.tiptap-body` styling. Server-safe.
- **Sanitize:** `sanitizeRichHtml` / `isRichTextEmpty` / `richTextToPlain`
  (`src/lib/rich-text.ts`, backed by `sanitize-html`). This is the XSS boundary
  — trainers author, clients/public view. Do not reuse the regex
  `sanitizeEmailHtml` (admin-only) for trainer content.
- **Email:** sanitize (don't `escapeHtml`) descriptions before embedding, and use
  `richTextToPlain` for the text part — see `client-notification-email.ts`.
- **Storage:** fields stay `String? @db.Text`. Plain text is valid HTML, so
  legacy values render fine; the only rule is display goes through `<RichText>`.

## Testing — ship tests WITH every feature

Every new feature ships with automated tests in the same change. This is not optional.

- **Unit/route logic** → `tests/unit/**/*.test.ts` (vitest). Mock Prisma with `vi.hoisted` + `vi.mock('@/lib/prisma', …)` — unit tests never touch a real DB. Security/ownership routes get a `tests/unit/security/*.test.ts` asserting tenant + permission guards. Run: `npx vitest run`.
- **User-facing flows** → `tests/e2e/*.spec.ts` (Playwright) against the isolated embedded Postgres (`tests/e2e/global-setup.ts`, creds in `tests/e2e/test-db.ts` `SEED`). Cover the owner happy path AND a cross-tenant/permission guard. Run: `npm run test:e2e:full`. Underscore-prefixed specs (`_*.spec.ts`) are dev utilities, excluded from the suite.
- New data a spec needs → extend `global-setup.ts` carefully (specs share one seeded DB; don't break existing counts).
- **CI gates both** — the `Tests` workflow (`.github/workflows/tests.yml`) runs unit + full e2e on every push to `main` and on PRs. Don't merge red. The e2e job runs `next build`, so never force `NODE_ENV=development` in CI (it breaks the `/_global-error` prerender).

## Bugs this codebase has already written once

Every rule below is a real bug found in an audit here, not a general principle.
They keep coming back because each one *looks* right while you're writing it —
the save returns 200, the button is hidden, the form validates on screen. Check
these before writing the code, not after. Findings are in `docs/audit-*.md`.

**1 · A field the user typed must survive a reload.** The only proof is
save → reload → assert. Three separate bugs were "it saved fine" and it hadn't:
an offering's cover image (any patch that omitted the key wiped it), its venue
(written only to the class run, so an offering with no run lost it), and its
schedule note (same, still open). When you add a field to a form, add the
round-trip test in the same change.

**2 · Never write a column name you haven't looked up.** `ClientProfile` has
`addressLine`, not `address`. The intake form mapped to `address`, Prisma threw,
the route 500d and the client was stuck behind the gate with no way out. Any
answer-to-column map gets a test that checks it against `schema.prisma`.

**3 · Validation in the browser is not validation.** `required` was enforced
only in `FormRunner`, so an empty intake stamped itself complete and lifted the
gate. The business email was `type="email"` on screen and *any string* in the
API. Whatever the form refuses, the route must refuse — `missingRequiredQuestions()`
exists for the forms case.

**4 · Undoing must undo all of it.** Ordering a product took stock, made a
request and raised an invoice; cancelling deleted the request and nothing else,
so the client still owed for a thing they'd never get. Count what the action did
and make the undo do the same number of things. Money already taken is a refund
decision — leave PAID/PARTIAL alone.

**5 · Props on a `'use client'` component are page source.** A paid download's
URL was passed in "just to render with" and the button hidden. The URL *was* the
paywall, and it was published to every client. Resolve entitlement on the SERVER
and send `null`. Check the JSON APIs too — `/api/my/products` was leaking the
same URL nobody had thought about.

**6 · Gate on the fact, not a proxy for it.** "Is this a paid download" was read
off *can this trainer take cards*, so every trainer without Stripe gave their
paid PDFs away. Payments being off changes HOW someone pays, never WHETHER.

**7 · An idempotency check must ignore cancelled rows.** "One invoice per thing
bought" found the CANCELLED invoice and raised nothing, so the re-order was
free.

**8 · A required question must be answerable.** A required "Dog's name" was
discarded when the client had no dog record — the answer went nowhere and the
trainer's list still said no dog. If a required answer needs a record that
doesn't exist yet, create it.

**9 · State that changes what you can do belongs where you choose.** "Out of
stock" only appeared inside the product sheet, so clients picked a thing, tapped
it, and only then found it gone.

**10 · Hard-coded help text rots.** The client Help FAQ described "My Diary" and
an "Email reminders" toggle years after both were gone. Derive screen names from
the same source the nav uses (`clientLabelFor`) — trainers rename them anyway.

## Ruflo coordination

Use ruflo selectively, not by default:

- **Use it for**: 3+ file changes, cross-cutting refactors (e.g. branding update touching app + marketing), security work, perf work.
- **Skip it for**: single-file edits, copy tweaks, image swaps, CSS adjustments.
- **Always useful**: the memory layer. Save feedback when something non-obvious works or breaks. Auto-memory lives at `~/.claude/projects/-Users-karl-pupmanager/memory/`.

For non-trivial tasks:
```bash
npx -y ruflo@latest memory search -q "[descriptive phrase]" -n pupmanager-architecture --threshold 0.2
npx -y ruflo@latest hooks route --task "[description]"
```

Querying the memory (verified 2026-07-17):

- The package is `ruflo`, **not** `@claude-flow/cli` (renamed; currently 3.32.0).
- There is **no `patterns` namespace**. The real ones are `pupmanager-` + one of:
  `architecture`, `app`, `data`, `marketing`, `marketing-audit`, `mobile`, `ops`, `conventions`.
  Search is namespace-scoped and defaults to an empty `default` — always pass `-n`.
- **Use a descriptive multi-word query.** The entries are long documents, so a single
  generic word ("architecture") scores below any useful threshold and returns nothing —
  it looks like an empty store but isn't. "tech stack dependencies versions" hits fine.
- `--threshold` defaults to 0.7; drop it to ~0.1–0.2 to widen recall. Only `-t semantic`
  (the default) returns anything — `-t keyword` and `-t hybrid` come back empty.
- Store writes to `cwd/.swarm/memory.db`, so run these from the repo root.

For genuine multi-file work, spawn a single Agent (Explore for research, coder/system-architect for implementation) — full swarms (4+ named agents) are overkill for solo work on this codebase.
