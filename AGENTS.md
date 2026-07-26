<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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
