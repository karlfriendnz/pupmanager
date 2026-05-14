import type { Metadata } from 'next'
import { Container } from '@/components/Container'
import { PricingTiersV2 } from '@/components/PricingTiersV2'

export const metadata: Metadata = {
  title: 'Pricing (v2 preview)',
  description:
    'Preview of the slider/add-ons configurator pricing page. Saved here for reference until multi-trainer accounts ship and we re-enable it.',
  robots: { index: false, follow: false },
}

export default function PricingV2Page() {
  return (
    <section className="py-20">
      <Container>
        <div className="mx-auto mb-10 max-w-3xl rounded-2xl border border-ink-100 bg-ink-50 p-5 text-sm text-ink-700">
          <p className="font-semibold text-ink-900">Pricing v2 — preview only</p>
          <p className="mt-1">
            This is the configurator design (trainers slider, tiered discount, add-on
            checkboxes). Saved here while the public <code>/pricing</code> page runs the
            simpler solo-only version. We&rsquo;ll switch the public page back when
            multi-trainer accounts ship.
          </p>
        </div>

        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent-500">
            Pricing
          </p>
          <h1 className="mt-4 text-5xl font-semibold tracking-tight text-ink-900">
            Pay for what you actually use.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-ink-700">
            Per-trainer pricing. Pick the add-ons you want and skip the ones you don&rsquo;t.
            Try it free for 10 days first — no card needed.
          </p>
        </div>

        <div className="mt-12">
          <PricingTiersV2 />
        </div>
      </Container>
    </section>
  )
}
