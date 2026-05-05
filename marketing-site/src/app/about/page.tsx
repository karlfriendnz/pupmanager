import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/Container'
import { ImageSlot } from '@/components/ImageSlot'

export const metadata: Metadata = {
  title: 'About',
  description: 'Why we are building PupManager and who we are building it for.',
}

export default function AboutPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-brand-50 to-white py-20">
        <Container>
          <p className="text-sm font-medium text-brand-700">About</p>
          <h1 className="mt-3 max-w-3xl text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
            We're building PupManager next to working trainers.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-700">
            One tool that knows you're a trainer — not a duct-tape stack of five that don't.
          </p>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <div className="grid items-start gap-12 lg:grid-cols-2">
            <ImageSlot
              label="Founder portrait, real working setting (~1200×1500)"
              aspect="4/5"
            />
            <div className="space-y-5 text-lg text-ink-700">
              {/* TODO: replace with real founder narrative. Should be specific —
                  the moment you knew this needed to exist, the trainers you talked
                  to first, the pain you were watching up close. */}
              <p>
                We started PupManager because the trainers we know are great at training dogs and
                tired of being half-decent secretaries. The duct-tape stack — Acuity, Stripe, a
                Google Sheet, a Notion doc per client — works until it doesn't. When it breaks it
                costs a session, a client, or a Sunday night.
              </p>
              <p>
                Every feature in the product traces back to a specific moment a trainer told us
                about. The 9:47 pm reschedule text. The Sunday afternoon reconciling Stripe against
                Venmo. The client who quietly left because they couldn't see their own progress.
              </p>
              <p>
                We're a small team. We ship fast, we answer our own email, and we don't pick sides
                in the methodology arguments. We just want to give you back the time you've been
                paying for in admin.
              </p>
            </div>
          </div>
        </Container>
      </section>

      <section className="border-t border-ink-100 bg-ink-50 py-20">
        <Container>
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-tight text-ink-900">What we believe</h2>
            <ul className="mt-8 space-y-6 text-lg text-ink-700">
              <li>
                <strong className="text-ink-900">The training is the point.</strong> Trainer
                software too often means kennel software with a training tab. We build the other
                way around.
              </li>
              <li>
                <strong className="text-ink-900">Public, transparent pricing.</strong> No demo
                calls. No hidden tiers. The pricing page tells you the price.
              </li>
              <li>
                <strong className="text-ink-900">Founder accessibility, not a support queue.</strong>{' '}
                Email us — you'll get a human reply, usually same day.
              </li>
              <li>
                <strong className="text-ink-900">No methodology politics.</strong> R+ or balanced,
                sport or pet, board-and-train or behavior consult. We're not picking your team.
              </li>
            </ul>
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <div className="rounded-3xl bg-brand-600 px-8 py-14 text-center text-white sm:px-16">
            <h2 className="text-3xl font-semibold tracking-tight">Want to hear how we're thinking?</h2>
            <p className="mx-auto mt-3 max-w-xl text-brand-100">
              Email <a href="mailto:hello@pupmanager.com" className="underline">hello@pupmanager.com</a>{' '}
              and we'll send you our roadmap and the next thing we're shipping.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/pricing"
                className="rounded-md bg-white px-5 py-3 font-medium text-brand-700 hover:bg-brand-50"
              >
                See pricing
              </Link>
              <a
                href="https://app.pupmanager.com/signup"
                className="rounded-md border border-white/30 px-5 py-3 font-medium text-white hover:bg-white/10"
              >
                Try for free
              </a>
            </div>
          </div>
        </Container>
      </section>
    </>
  )
}
