import type { ReactNode } from 'react'
import Image from 'next/image'
import { Container } from './Container'
import { ImageSlot } from './ImageSlot'
import { JsonLd } from './JsonLd'
import { getPost } from '@/lib/posts'

type Props = {
  title: string
  description?: string
  date: string
  author?: string
  slug: string
  children: ReactNode
}

export function BlogPostLayout({
  title,
  description,
  date,
  author,
  slug,
  children,
}: Props) {
  const meta = getPost(slug)
  const coverImage = meta?.coverImage
  const coverLabel = meta?.coverLabel ?? ''
  const url = `https://pupmanager.com/blog/${slug}`
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description,
    datePublished: date,
    dateModified: date,
    image: coverImage ? `https://pupmanager.com${coverImage}` : undefined,
    author: author
      ? { '@type': 'Person', name: author }
      : { '@type': 'Organization', name: 'PupManager' },
    publisher: {
      '@type': 'Organization',
      name: 'PupManager',
      logo: { '@type': 'ImageObject', url: 'https://pupmanager.com/icon-1024.png' },
    },
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  }

  return (
    <article className="py-16">
      <JsonLd data={articleSchema} />
      <Container className="max-w-3xl">
        <p className="text-sm text-ink-500">{formatDate(date)}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-5 text-lg text-ink-700">{description}</p>
        )}

        <div className="mt-10 overflow-hidden rounded-2xl">
          {coverImage ? (
            <Image
              src={coverImage}
              alt={coverLabel}
              width={1600}
              height={900}
              priority
              sizes="(max-width: 768px) 100vw, 768px"
              className="h-auto w-full"
            />
          ) : (
            <ImageSlot label={coverLabel} aspect="16/9" className="!rounded-none" />
          )}
        </div>

        <div className="prose prose-slate mt-10 max-w-none prose-a:text-brand-700">
          {children}
        </div>
      </Container>
    </article>
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
