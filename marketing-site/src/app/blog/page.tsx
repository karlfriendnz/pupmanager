import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/Container'
import { getAllPosts } from '@/lib/posts'

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Notes from the team and the field.',
}

export default function BlogIndex() {
  const posts = getAllPosts()
  return (
    <section className="py-20">
      <Container>
        <h1 className="text-4xl font-semibold tracking-tight">Blog</h1>
        <ul className="mt-12 divide-y divide-ink-300/50 border-y border-ink-300/50">
          {posts.map((p) => (
            <li key={p.slug} className="py-6">
              <Link href={`/blog/${p.slug}`} className="group block">
                <p className="text-sm text-ink-500">{formatDate(p.date)}</p>
                <h2 className="mt-1 text-xl font-medium group-hover:text-brand-700">{p.title}</h2>
                {p.description && <p className="mt-1 text-ink-700">{p.description}</p>}
              </Link>
            </li>
          ))}
          {posts.length === 0 && <li className="py-6 text-ink-500">No posts yet.</li>}
        </ul>
      </Container>
    </section>
  )
}

function formatDate(iso: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
