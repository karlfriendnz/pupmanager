import Link from 'next/link'
import { Container } from '@/components/Container'

export const metadata = {
  title: 'Page not found',
  description: "This page has gone for a walk. Let's get you back on track.",
}

export default function NotFound() {
  return (
    <section className="py-24">
      <Container>
        <div className="mx-auto max-w-xl text-center">
          <p
            aria-hidden
            className="text-7xl leading-none"
            style={{ filter: 'grayscale(0.1)' }}
          >
            🐾
          </p>
          <p className="mt-6 text-sm font-medium uppercase tracking-[0.2em] text-accent-500">
            404
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
            This page has gone for a walk.
          </h1>
          <p className="mt-5 text-lg text-ink-700">
            We couldn't find what you were looking for. It may have moved, or never existed in the
            first place. Either way, here are some good places to head next.
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              href="/"
              className="rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Back to home
            </Link>
            <Link
              href="/features"
              className="rounded-full border border-ink-300 px-6 py-3 text-sm font-semibold text-ink-900 transition hover:bg-ink-50"
            >
              See features
            </Link>
            <Link
              href="/pricing"
              className="rounded-full border border-ink-300 px-6 py-3 text-sm font-semibold text-ink-900 transition hover:bg-ink-50"
            >
              See pricing
            </Link>
          </div>

          <p className="mt-12 text-sm text-ink-500">
            Looking for something specific?{' '}
            <Link href="/contact" className="font-medium text-brand-700 hover:text-brand-800">
              Drop us a line
            </Link>{' '}
            — we reply within one business day.
          </p>
        </div>
      </Container>
    </section>
  )
}
