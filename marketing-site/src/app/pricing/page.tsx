import type { Metadata } from 'next'
import { Container } from '@/components/Container'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Simple, transparent pricing for solo and small-team dog trainers.',
}

const tiers = [
  {
    name: 'Solo',
    price: '$39',
    cadence: '/mo',
    blurb: 'One trainer, unlimited clients.',
    features: ['Scheduling + card on file', 'Client app', 'Structured progress', 'Email support'],
    cta: 'Start free',
  },
  {
    name: 'Team',
    price: '$59',
    cadence: '/mo per trainer',
    blurb: 'Up to 5 trainers, shared calendar.',
    features: ['Everything in Solo', 'Shared calendar', 'Group classes with waitlist', 'Roles & permissions'],
    cta: 'Start free',
    featured: true,
  },
]

export default function PricingPage() {
  return (
    <section className="py-20">
      <Container>
        <h1 className="text-4xl font-semibold tracking-tight">Pricing</h1>
        <p className="mt-3 max-w-2xl text-ink-700">
          One price, no add-ons, no demo call. 14-day trial, no card required.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`rounded-2xl border p-8 ${
                t.featured ? 'border-brand-600 ring-1 ring-brand-600' : 'border-ink-300/60'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <h2 className="text-xl font-semibold">{t.name}</h2>
                <p className="text-3xl font-semibold tracking-tight">
                  {t.price}
                  <span className="text-base font-normal text-ink-500">{t.cadence}</span>
                </p>
              </div>
              <p className="mt-2 text-ink-700">{t.blurb}</p>
              <ul className="mt-6 space-y-2 text-sm text-ink-700">
                {t.features.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
              <a
                href="https://app.pupmanager.com/signup"
                className={`mt-8 inline-block rounded-md px-4 py-2 ${
                  t.featured
                    ? 'bg-brand-600 text-white hover:bg-brand-700'
                    : 'border border-ink-300 text-ink-900 hover:bg-ink-300/20'
                }`}
              >
                {t.cta}
              </a>
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}
