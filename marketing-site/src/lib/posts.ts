export type PostMeta = {
  slug: string
  title: string
  description: string
  date: string
  author?: string
  /**
   * Optional path to a real cover image (e.g. "/blog/duct-tape-stack-cover.png").
   * If absent, the listing + post header render a labelled placeholder.
   */
  coverImage?: string
  /** Short descriptive label used as alt text + placeholder copy. */
  coverLabel: string
}

/**
 * Static registry of published blog posts. Single source of truth for the
 * listing page AND the per-post header (BlogPostLayout reads `coverImage` and
 * `coverLabel` from here via `getPost(slug)`).
 *
 * Each post lives at `src/app/blog/<slug>/page.{tsx,mdx}` and can lay itself
 * out however it likes — there is no enforced template. To add a post:
 *   1. Create `src/app/blog/<slug>/page.mdx` (or `.tsx`)
 *   2. Add a row below so it shows up in the index and sitemap. Include
 *      `coverImage` here to give the post a hero image on both the listing
 *      page and the post itself (e.g. `coverImage: '/blog/<slug>.png'`).
 *
 * Posts that want the default prose treatment can wrap their content in
 * `<BlogPostLayout>` from `@/components/BlogPostLayout`. Posts that want a
 * custom layout (full-bleed hero, multi-column, etc.) just don't import it.
 *
 * Schedule new posts at least a week apart — keeps Google&rsquo;s freshness
 * signal healthy and gives each post time to breathe.
 */
export const posts: PostMeta[] = [
  {
    slug: 'structured-session-notes',
    title: 'Dog training session notes: a 10-minute system that builds a story',
    description:
      'How dog trainers can take structured session notes in 10 minutes — and why it changes the next consult, the renewal conversation, and the client relationship.',
    date: '2026-05-09',
    author: 'Karl',
    coverLabel: 'Trainer phone capturing a session note + video, in the field',
  },
  {
    slug: 'duct-tape-stack',
    title: 'Dog training software vs the duct-tape stack: the real $170/month math',
    description:
      "Booking app + Mailchimp + Thinkific + a Notion doc + a Google Sheet ≈ $170/mo — and 8–11 hours of weekly admin you don't bill. Here's the math, and the alternative.",
    date: '2026-05-02',
    author: 'Karl',
    coverImage: '/blog/duct-tape-stack-v3.png',
    coverLabel: 'A messy duct-tape stack of tools side by side with one tidy app',
  },
  {
    slug: 'sunday-night',
    title: 'The Sunday-night problem',
    description:
      'Why Sunday night disappears for most working dog trainers — and the four-line audit that gets it back.',
    date: '2026-04-25',
    author: 'Karl',
    coverLabel: 'A laptop, phone, and notepad on a kitchen table at dusk',
  },
]

export function getAllPosts(): PostMeta[] {
  return [...posts].sort((a, b) => (a.date < b.date ? 1 : -1))
}

export function getPostSlugs(): string[] {
  return posts.map((p) => p.slug)
}

export function getPost(slug: string): PostMeta | undefined {
  return posts.find((p) => p.slug === slug)
}
