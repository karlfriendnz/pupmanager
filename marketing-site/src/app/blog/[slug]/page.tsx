import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Container } from '@/components/Container'
import { getAllPosts, getPostSlugs } from '@/lib/posts'

export function generateStaticParams() {
  return getPostSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const meta = getAllPosts().find((p) => p.slug === slug)
  if (!meta) return {}
  return { title: meta.title, description: meta.description }
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const meta = getAllPosts().find((p) => p.slug === slug)
  if (!meta) notFound()

  const { default: Post } = await import(`@/content/posts/${slug}.mdx`)

  return (
    <article className="py-16">
      <Container className="max-w-2xl">
        <p className="text-sm text-ink-500">{formatDate(meta.date)}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">{meta.title}</h1>
        <div className="prose prose-slate mt-10 max-w-none prose-a:text-brand-700">
          <Post />
        </div>
      </Container>
    </article>
  )
}

function formatDate(iso: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
