import Link from 'next/link'
import { Container } from '@/components/Container'

export default function HomePage() {
  return (
    <>
      <section className="pt-24 pb-20">
        <Container>
          <p className="text-sm font-medium text-brand-600">For dog trainers</p>
          <h1 className="mt-3 max-w-3xl text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
            You're great at training dogs. We'll handle the rest.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-700">
            Scheduling, payments, structured progress, and a client app worth showing off — built for solo
            and small-team trainers who've outgrown the spreadsheet stack.
          </p>
          <div className="mt-8 flex gap-3">
            <a
              href="https://app.pupmanager.com/signup"
              className="rounded-md bg-brand-600 px-5 py-2.5 text-white hover:bg-brand-700"
            >
              Start free
            </a>
            <Link
              href="/pricing"
              className="rounded-md border border-ink-300 px-5 py-2.5 text-ink-900 hover:bg-ink-300/20"
            >
              See pricing
            </Link>
          </div>
        </Container>
      </section>

      <section className="py-16 border-t border-ink-300/40">
        <Container>
          <h2 className="text-2xl font-semibold tracking-tight">Built around how trainers actually work</h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {features.map((f) => (
              <div key={f.title}>
                <h3 className="font-medium text-ink-900">{f.title}</h3>
                <p className="mt-2 text-ink-700">{f.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>
    </>
  )
}

const features = [
  {
    title: 'Sessions and homework, in one place',
    body: 'Mark tasks complete, drop in a video, and the client sees tonight\'s homework before they\'re home from your appointment.',
  },
  {
    title: 'Card on file at booking',
    body: 'No-shows charge automatically per your policy. The Sunday-night reconcile goes away.',
  },
  {
    title: 'A client app you\'ll want to show off',
    body: 'Polished enough that prospective clients ask which gym you use. The product sells the upgrade for you.',
  },
]
