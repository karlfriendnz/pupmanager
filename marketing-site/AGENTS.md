# Marketing site — agent + human guide

This is the public marketing site for PupManager, separate from the app at `app.pupmanager.com`. It lives in this repo so brand tokens, copy, and assets can be shared with the main Next.js app.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind 4 (CSS-first theme in `src/app/globals.css`)
- MDX for blog posts (`@next/mdx` + `gray-matter` for frontmatter)
- Deployed on Vercel as a separate project from the main app

> Same Next.js version as the main app. The repo's root `AGENTS.md` notes that this Next.js has breaking changes vs. older versions — read `node_modules/next/dist/docs/` before writing code.

## Layout

```
marketing-site/
  src/
    app/                  # routes (App Router)
      layout.tsx          # nav + footer wrap
      page.tsx            # home
      pricing/page.tsx
      blog/page.tsx       # index
      blog/[slug]/page.tsx
      globals.css         # Tailwind + brand tokens
    components/           # Nav, Footer, Container
    content/posts/*.mdx   # blog posts (frontmatter: title, description, date, author)
    lib/posts.ts          # reads frontmatter from posts/
    mdx-components.tsx
  next.config.ts          # MDX wired in
  package.json
```

## How to add a blog post

1. Create `src/content/posts/<slug>.mdx`.
2. Add frontmatter:
   ```mdx
   ---
   title: Post title
   description: One-line summary used on the index and meta tags.
   date: 2026-05-12
   author: Karl
   ---
   ```
3. Write the post in markdown. JSX is allowed (you can drop in components).
4. The blog index and `/blog/[slug]` pick it up automatically.

## How to edit copy

- **Home, pricing, nav, footer**: edit the matching `.tsx` file. Component code lives next to copy on purpose — small site, low overhead.
- **Voice rules** are non-negotiable. See `branding/marketing/_context/customer-profile.md` (in the parent repo) for the full picture, but the short version:
  - Plain-spoken professional. Linear / Cal.com / Superhuman, not Mindbody.
  - Never write "fur baby," "pet parent," "doggo," "tail-wagging," emoji, or movement politics (R+ vs. balanced).
  - Treat the reader like the credentialed working trainer they are.
  - The product positioning line is **"We give you back Sunday night."**
- The bullseye customer is a solo or 2–3 person training-only business owner, 2–7 years in, on a duct-tape stack of Acuity + Stripe + Google Sheets. Lead with their pain, not our features.

## Brand tokens

Colors live in `src/app/globals.css` under `@theme`. They mirror the main app's `globals.css` — keep the brand-* and accent-* values in sync if you change them in either place.

## Local dev

```
cd marketing-site
npm install
npm run dev      # http://localhost:3001
npm run build    # production build
npm run lint
```

The dev port is 3001 so it doesn't collide with the main app on 3000.

## Deployment

Vercel project should point at `marketing-site/` as its root directory. Build command: `next build`. Output: framework-detected. No env vars required for the public site.

## When making changes

- Prefer editing existing files over creating new ones.
- Don't add a CMS, headless service, or new dep without asking — the whole point is "content in git, agent edits via PR."
- For UI changes, run `npm run dev` and look at the page in a browser before reporting done.
