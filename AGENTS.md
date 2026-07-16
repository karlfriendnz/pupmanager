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
