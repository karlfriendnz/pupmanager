# PupManager marketing site — agent + human guide

This is the public marketing site for PupManager (pupmanager.com). It lives in its own repo, separate from the main app at `app.pupmanager.com`.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind 4 (CSS-first theme in `src/app/globals.css`)
- MDX for blog posts (`@next/mdx` + `gray-matter` for frontmatter)
- Deployed on Vercel — auto-deploys on push to `main`, preview URLs on PRs

## Layout

```
.
├── src/
│   ├── app/                # routes (App Router)
│   │   ├── layout.tsx      # nav + footer wrap
│   │   ├── page.tsx        # home
│   │   ├── about/page.tsx
│   │   ├── pricing/page.tsx
│   │   ├── vs/duct-tape-stack/page.tsx
│   │   ├── blog/page.tsx
│   │   ├── blog/[slug]/page.tsx
│   │   └── globals.css     # Tailwind + brand tokens
│   ├── components/         # Nav, Footer, Container, ImageSlot
│   ├── content/posts/*.mdx # blog posts (frontmatter: title, description, date, author)
│   ├── lib/posts.ts        # reads frontmatter from posts/
│   └── mdx-components.tsx
├── public/                 # logomark.svg, wordmark.svg, icon-1024.png
├── next.config.ts
└── package.json
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
3. Write the post. JSX is allowed.
4. Open a PR — Vercel posts a preview URL. Merge to `main` → live on pupmanager.com.

## How to edit copy

- **Home, pricing, about, vs/duct-tape-stack**: edit the matching `.tsx` file.
- **Voice rules** are non-negotiable. The full customer profile lives in the main `pupmanager` repo at `branding/marketing/_context/customer-profile.md`. Short version:
  - Plain-spoken professional. Linear / Cal.com / Superhuman, not Mindbody.
  - Never write "fur baby," "pet parent," "doggo," "tail-wagging," emoji, or movement politics (R+ vs. balanced).
  - Treat the reader like the credentialed working trainer they are.
  - The product positioning line is **"We give you back Sunday night."**
- The bullseye customer is a solo or 2–3 person training-only business owner, 2–7 years in, on a duct-tape stack of Acuity + Stripe + Google Sheets.

## Brand assets

- `public/logomark.svg` — standalone P-with-dog mark (single-color, fill follows context)
- `public/wordmark.svg` — horizontal logomark + "PupManager" wordmark
- `public/icon-1024.png` — full-color app icon (favicon + apple-touch-icon)
- Brand teal sampled from the app icon: scale lives in `src/app/globals.css` under `@theme` (`--color-brand-50` … `--color-brand-900`)

## Image slots

`<ImageSlot label="..." aspect="4/3" />` marks every place the site needs art. Replace with `next/image` calls when art is supplied:

```tsx
import Image from 'next/image'
<Image src="/heroes/dashboard.png" alt="Trainer dashboard" width={1200} height={900} />
```

## Local dev

```
npm install
npm run dev      # http://localhost:3001
npm run build    # production build
npm run lint
```

## Deployment

- Vercel project: `pupmanager-marketing-site` (under `karlfriendnzs-projects`)
- Push to `main` → auto-deploy to pupmanager.com
- PRs → preview URL posted in checks
- DNS: `pupmanager.com` (apex A → 76.76.21.21) and `www` (CNAME → cname.vercel-dns.com, 308 redirect to apex) at Namecheap

## When making changes

- Prefer editing existing files over creating new ones.
- No fabricated testimonials, names, or quotes — the audience will spot them.
- Don't add a CMS, headless service, or new dep without asking — content-in-git is the maintenance promise.
- For UI changes, run `npm run dev` and look at the page in a browser before reporting done.
