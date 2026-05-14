import type { Metadata } from 'next'
import { Container } from '@/components/Container'
import { PricingTiers } from '@/components/PricingTiers'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Simple, transparent pricing for solo and small-team dog trainers.',
}

export default function PricingPage() {
  return (
    <section className="py-20">
      <Container>
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent-500">
            Pricing
          </p>
          <h1 className="mt-4 text-5xl font-semibold tracking-tight text-ink-900">
            One trainer. One price.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-ink-700">
            Solo plans only for now — multi-trainer accounts are on the way. Try every feature
            free for 10 days before you decide.
          </p>
        </div>

        <div className="mt-12">
          <PricingTiers />
        </div>
      </Container>
    </section>
  )
}
