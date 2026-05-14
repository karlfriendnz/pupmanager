import type { MetadataRoute } from 'next'
import { getAllPosts } from '@/lib/posts'
import { categories } from '@/lib/features'

const SITE = 'https://pupmanager.com'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE}/`,                     lastModified: now, changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${SITE}/features`,             lastModified: now, changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${SITE}/pricing`,              lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE}/roadmap`,              lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${SITE}/changelog`,            lastModified: now, changeFrequency: 'weekly',  priority: 0.6 },
    { url: `${SITE}/faq`,                  lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE}/about`,                lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE}/blog`,                 lastModified: now, changeFrequency: 'weekly',  priority: 0.6 },
    { url: `${SITE}/contact`,              lastModified: now, changeFrequency: 'yearly',  priority: 0.5 },
    { url: `${SITE}/privacy`,              lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE}/terms`,                lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
  ]

  const categoryRoutes: MetadataRoute.Sitemap = categories.map((c) => ({
    url: `${SITE}/features/${c.id}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }))

  const posts: MetadataRoute.Sitemap = getAllPosts().map((p) => ({
    url: `${SITE}/blog/${p.slug}`,
    lastModified: p.date ? new Date(p.date) : now,
    changeFrequency: 'yearly',
    priority: 0.6,
  }))

  return [...staticRoutes, ...categoryRoutes, ...posts]
}
