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

## Ruflo coordination

Use ruflo selectively, not by default:

- **Use it for**: 3+ file changes, cross-cutting refactors (e.g. branding update touching app + marketing), security work, perf work.
- **Skip it for**: single-file edits, copy tweaks, image swaps, CSS adjustments.
- **Always useful**: the memory layer. Save feedback when something non-obvious works or breaks. Auto-memory lives at `~/.claude/projects/-Users-karl-pupmanager/memory/`.

For non-trivial tasks:
```bash
npx @claude-flow/cli@latest memory search --query "[keywords]" --namespace patterns
npx @claude-flow/cli@latest hooks route --task "[description]"
```

For genuine multi-file work, spawn a single Agent (Explore for research, coder/system-architect for implementation) — full swarms (4+ named agents) are overkill for solo work on this codebase.
