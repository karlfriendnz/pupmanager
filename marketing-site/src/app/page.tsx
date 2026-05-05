import Link from 'next/link'
import { Container } from '@/components/Container'

export default function HomePage() {
  return (
    <>
      <section className="pt-24 pb-20">
        <Container>
          <p className="text-sm font-medium text-brand-600">For dog trainers</p>
          <h1 className="mt-3 max-w-4xl text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
            You're great at training dogs.
            <br />
            <span className="text-ink-500">Tired of being a half-decent secretary?</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-700">
            PupManager is the back office for solo and small-team trainers — scheduling, structured
            progress, and a client app worth showing off. One tool that knows you're a trainer, not a
            duct-tape stack of five that don't.
          </p>
          <p className="mt-4 max-w-2xl text-lg font-medium text-ink-900">We give you back Sunday night.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="https://app.pupmanager.com/signup"
              className="rounded-md bg-brand-600 px-5 py-2.5 text-white hover:bg-brand-700"
            >
              Start free
            </a>
            <Link
              href="/vs/duct-tape-stack"
              className="rounded-md border border-ink-300 px-5 py-2.5 text-ink-900 hover:bg-ink-300/20"
            >
              See what it replaces
            </Link>
          </div>
          <p className="mt-3 text-sm text-ink-500">14-day trial. No card required. No demo call.</p>
        </Container>
      </section>

      <section className="border-t border-ink-300/40 py-20">
        <Container>
          <h2 className="max-w-3xl text-3xl font-semibold tracking-tight">
            You know the drill.
          </h2>
          <p className="mt-4 max-w-3xl text-lg text-ink-700">
            Last reschedule text at 9:47 pm. The Notes app full of half-typed session updates you
            meant to put in the client doc. A Google Sheet that hasn't been updated since November.
            Four "what was the cue again?" texts in a week. A Sunday afternoon reconciling Stripe
            against Venmo against a printed roll-call sheet.
          </p>
          <p className="mt-6 max-w-3xl text-lg text-ink-700">
            None of it is the work. All of it eats the work.
          </p>
        </Container>
      </section>

      <section className="border-t border-ink-300/40 py-20">
        <Container>
          <h2 className="text-3xl font-semibold tracking-tight">Built around the actual job</h2>
          <p className="mt-3 max-w-2xl text-ink-700">
            Trainer software usually means kennel software with a training tab. PupManager is built
            the other way around — the training is the point.
          </p>

          <div className="mt-12 grid gap-10 md:grid-cols-2">
            {features.map((f) => (
              <div key={f.title}>
                <h3 className="text-lg font-medium text-ink-900">{f.title}</h3>
                <p className="mt-2 text-ink-700">{f.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-ink-300/40 py-20">
        <Container>
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">One tool. Replaces five.</h2>
              <p className="mt-3 max-w-xl text-ink-700">
                Acuity, Mailchimp, Thinkific, a Notion doc per client, a Google Sheet you don't trust.
                The stack math is roughly $170/mo. PupManager is $39.
              </p>
            </div>
            <Link
              href="/vs/duct-tape-stack"
              className="self-start rounded-md border border-ink-300 px-5 py-2.5 text-ink-900 hover:bg-ink-300/20 md:self-end"
            >
              See the comparison →
            </Link>
          </div>
        </Container>
      </section>

      <section className="border-t border-ink-300/40 py-20">
        <Container>
          <h2 className="text-3xl font-semibold tracking-tight">Pricing</h2>
          <p className="mt-3 max-w-2xl text-ink-700">
            Public, transparent, no per-feature add-ons. <Link href="/pricing" className="text-brand-700 underline">See pricing →</Link>
          </p>
        </Container>
      </section>
    </>
  )
}

const features = [
  {
    title: 'Structured progress, not a Notes-app heap',
    body:
      'Each session has tasks, scores, video attached, and notes. The client sees tonight\'s homework before they\'re home from your appointment. You can show a chart at the next consult — "look how much Riley has improved on the recall."',
  },
  {
    title: 'A client app worth showing off',
    body:
      'Polished enough that prospective clients ask which gym you use. The product sells the upgrade for you. Web access for the older-skewing clienteles who won\'t install another app.',
  },
  {
    title: 'Scheduling that knows it\'s a session',
    body:
      'Package credits, buffer time between sessions, recurring slots, partner calendar visibility. Reschedule from a single link instead of a 3-message text thread.',
  },
  {
    title: 'Group classes, cohorts, make-ups',
    body:
      'Run a 6-week series with cohort enrollment, attendance per team in two taps, automatic make-up tracking. Waitlist promotion ships next.',
  },
]
