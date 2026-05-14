import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Container } from '@/components/Container'
import { ImageSlot } from '@/components/ImageSlot'
import { categories, getCategory, getSectionsByCategory, type FeatureSection } from '@/lib/features'

export function generateStaticParams() {
  return categories.map((c) => ({ category: c.id }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const { category } = await params
  const cat = getCategory(category)
  if (!cat) return {}
  return {
    title: cat.seoTitle,
    description: cat.blurb,
  }
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>
}) {
  const { category } = await params
  const cat = getCategory(category)
  if (!cat) notFound()

  const items = getSectionsByCategory(cat.id)
  const otherCategories = categories.filter((c) => c.id !== cat.id)

  return (
    <>
      <section className="bg-gradient-to-b from-brand-50 to-white py-20">
        <Container>
          <p className="text-sm font-medium text-brand-700">
            <Link href="/features" className="hover:text-brand-800">
              Features
            </Link>{' '}
            <span className="text-ink-300">/</span>{' '}
            <span className="text-ink-700">{cat.eyebrow}</span>
          </p>
          <h1 className="mt-4 max-w-3xl text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
            {cat.title}
            {cat.comingSoon && (
              <span className="ml-3 inline-block rounded-full bg-accent-500 px-3 py-1 align-middle text-xs font-semibold uppercase tracking-wider text-white">
                Coming soon
              </span>
            )}
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-700">{cat.blurb}</p>
        </Container>
      </section>

      {items.map((s, i) => (
        <FeatureBlock key={s.id} section={s} reverse={i % 2 === 1} />
      ))}

      <section className="bg-ink-50 py-20">
        <Container>
          <div data-reveal>
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight text-ink-900">
                More features
              </h2>
              <p className="mt-3 text-ink-700">
                The rest of what PupManager does, sorted into easy categories.
              </p>
            </div>

            <ul className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {otherCategories.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/features/${c.id}`}
                    className="group flex h-full flex-col rounded-2xl border border-ink-100 bg-white p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-ink-900/5"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-500">
                      {c.eyebrow}
                    </p>
                    <p className="mt-2 font-semibold text-ink-900 group-hover:text-brand-700">
                      {c.title}
                    </p>
                    <p className="mt-2 text-sm text-ink-700">{c.shortBlurb}</p>
                    {c.comingSoon && (
                      <span className="mt-3 inline-block w-fit rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-500">
                        Coming soon
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section className="py-24">
        <Container>
          <div data-reveal className="rounded-3xl bg-brand-600 px-8 py-16 text-center text-white sm:px-16">
            <h2 className="text-4xl font-semibold tracking-tight">Try it on your own clients.</h2>
            <p className="mx-auto mt-4 max-w-xl text-brand-100">
              10 days free. No card. We&apos;ll set up a starter template so you can be booking
              sessions within an hour.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href="https://app.pupmanager.com/register"
                className="rounded-md bg-white px-5 py-3 font-medium text-brand-700 hover:bg-brand-50"
              >
                Try for free
              </a>
              <Link
                href="/pricing"
                className="rounded-md border border-white/30 px-5 py-3 font-medium text-white hover:bg-white/10"
              >
                See pricing
              </Link>
            </div>
          </div>
        </Container>
      </section>
    </>
  )
}

function FeatureBlock({ section, reverse }: { section: FeatureSection; reverse: boolean }) {
  return (
    <section id={section.id} className="border-b border-ink-100 py-20 scroll-mt-16">
      <Container>
        <div
          data-reveal
          className={`grid items-center gap-12 lg:grid-cols-2 ${
            reverse ? 'lg:[&>:first-child]:order-2' : ''
          }`}
        >
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-brand-700">
              {section.eyebrow}
              {section.comingSoon && (
                <span className="inline-block rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-500">
                  Coming soon
                </span>
              )}
            </p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-ink-900">
              {section.title}
            </h2>
            <p className="mt-5 text-lg text-ink-700">{section.body}</p>
            <ul className="mt-6 space-y-3 text-ink-700">
              {section.bullets.map((b) => (
                <li key={b} className="flex gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <ImageSlot label={section.imageLabel} aspect="5/4" />
        </div>
      </Container>
    </section>
  )
}
