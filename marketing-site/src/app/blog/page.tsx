import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Container } from '@/components/Container'
import { ImageSlot } from '@/components/ImageSlot'
import { getAllPosts, type PostMeta } from '@/lib/posts'

export const metadata: Metadata = {
  title: 'Blog',
  description:
    'Practical writing for working dog trainers — software, business, and the bits in between.',
}

export default function BlogIndex() {
  const posts = getAllPosts()
  return (
    <>
      <section className="bg-gradient-to-b from-brand-50 to-white py-20">
        <Container>
          <p className="text-sm font-medium text-brand-700">Blog</p>
          <h1 className="mt-3 max-w-3xl text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
            Notes for working dog trainers.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-700">
            Short, practical writing on software, the business side, and the bits in between.
            One post every couple of weeks. No fluff.
          </p>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          {posts.length === 0 ? (
            <p className="text-ink-500">No posts yet.</p>
          ) : (
            <>
              <ul data-reveal className="grid gap-10 md:grid-cols-2">
                {posts.slice(0, 2).map((p) => (
                  <li key={p.slug}>
                    <FeaturedPostCard post={p} />
                  </li>
                ))}
              </ul>

              {posts.length > 2 && (
                <div data-reveal className="mt-20">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-ink-500">
                    Older posts
                  </p>
                  <ul className="mt-6 divide-y divide-ink-100 border-t border-ink-100">
                    {posts.slice(2).map((p) => (
                      <li key={p.slug}>
                        <CompactPostRow post={p} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Container>
      </section>
    </>
  )
}

function FeaturedPostCard({ post }: { post: PostMeta }) {
  return (
    <Link href={`/blog/${post.slug}`} className="group block">
      <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
        {post.coverImage ? (
          <Image
            src={post.coverImage}
            alt={post.coverLabel}
            width={1200}
            height={675}
            sizes="(max-width: 768px) 100vw, 540px"
            className="h-auto w-full transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <ImageSlot
            label={post.coverLabel}
            aspect="16/9"
            className="!rounded-none border-0"
          />
        )}
      </div>
      <p className="mt-5 text-sm text-ink-500">{formatDate(post.date)}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900 group-hover:text-brand-700">
        {post.title}
      </h2>
      {post.description && (
        <p className="mt-3 text-ink-700">{post.description}</p>
      )}
      <p className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
        Read it
        <span aria-hidden className="transition-transform group-hover:translate-x-1">
          →
        </span>
      </p>
    </Link>
  )
}

function CompactPostRow({ post }: { post: PostMeta }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group flex gap-6 py-6 sm:gap-8"
    >
      <div className="h-[200px] w-[300px] shrink-0 overflow-hidden rounded-xl border border-ink-100 bg-white max-sm:h-[120px] max-sm:w-[160px]">
        {post.coverImage ? (
          <Image
            src={post.coverImage}
            alt={post.coverLabel}
            width={600}
            height={400}
            sizes="(max-width: 640px) 160px, 300px"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <ImageSlot
            label={post.coverLabel}
            aspect="3/2"
            className="!h-full !w-full !rounded-none border-0"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <p className="text-sm text-ink-500">{formatDate(post.date)}</p>
        <h3 className="mt-1 text-xl font-semibold tracking-tight text-ink-900 group-hover:text-brand-700">
          {post.title}
        </h3>
        {post.description && (
          <p className="mt-2 line-clamp-2 text-sm text-ink-700 sm:text-base">
            {post.description}
          </p>
        )}
        <p className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
          Read it
          <span aria-hidden className="transition-transform group-hover:translate-x-1">
            →
          </span>
        </p>
      </div>
    </Link>
  )
}

function formatDate(iso: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
