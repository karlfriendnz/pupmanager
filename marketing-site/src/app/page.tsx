import Link from 'next/link'
import { Container } from '@/components/Container'
import { ImageSlot } from '@/components/ImageSlot'

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <FeatureGrid />
      <SegmentGrid />
      <VisionSection />
      <FounderSection />
      <Testimonials />
      <NewsletterSection />
      <FinalCTA />
    </>
  )
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 to-white pb-24 pt-20">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="text-sm font-medium text-brand-700">For dog trainers</p>
            <h1 className="mt-4 max-w-2xl text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
              You're great at training dogs.
              <span className="block text-ink-500">Tired of being a half-decent secretary?</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-700">
              PupManager is the back office for solo and small-team trainers — scheduling,
              structured progress, and a client app worth showing off. One tool that knows you're a
              trainer, not five that don't.
            </p>
            <p className="mt-4 max-w-xl text-lg font-medium text-ink-900">
              We give you back Sunday night.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="https://app.pupmanager.com/signup"
                className="rounded-md bg-brand-600 px-5 py-3 font-medium text-white hover:bg-brand-700"
              >
                Try for free
              </a>
              <Link
                href="/vs/duct-tape-stack"
                className="rounded-md border border-ink-300 px-5 py-3 font-medium text-ink-900 hover:bg-ink-100"
              >
                See what it replaces
              </Link>
            </div>
            <p className="mt-3 text-sm text-ink-500">14-day trial. No card required. No demo call.</p>
          </div>

          <div className="lg:col-span-5">
            <ImageSlot
              label="Hero shot — trainer-side dashboard or client-app screen on phone (~1200×900)"
              aspect="4/3"
            />
          </div>
        </div>
      </Container>
    </section>
  )
}

function FeatureGrid() {
  return (
    <section id="features" className="border-t border-ink-100 py-24">
      <Container>
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-brand-700">What's in the box</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-ink-900">
            Built around the actual job
          </h2>
          <p className="mt-4 text-lg text-ink-700">
            Trainer software usually means kennel software with a training tab. PupManager is built
            the other way around — the training is the point.
          </p>
        </div>

        <div className="mt-14 grid gap-10 md:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="flex gap-5">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700">
                <span className="font-semibold">{f.glyph}</span>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-ink-900">{f.title}</h3>
                <p className="mt-2 text-ink-700">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}

function SegmentGrid() {
  return (
    <section className="border-t border-ink-100 bg-ink-50 py-24">
      <Container>
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-brand-700">Who it's for</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-ink-900">
            Built for working trainers, not facilities
          </h2>
          <p className="mt-4 text-lg text-ink-700">
            Solo or small team. Private and group. The credentialed pro on a duct-tape stack.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {segments.map((s) => (
            <div key={s.title} className="rounded-2xl border border-ink-100 bg-white p-6">
              <ImageSlot label={s.imageLabel} aspect="4/3" className="mb-5" />
              <h3 className="text-lg font-semibold text-ink-900">{s.title}</h3>
              <p className="mt-2 text-sm text-ink-700">{s.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}

function VisionSection() {
  return (
    <section className="border-t border-ink-100 py-24">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-brand-700">We're just getting started</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-ink-900">
              One tool. Replaces five.
            </h2>
            <p className="mt-5 text-lg text-ink-700">
              Acuity for scheduling, Mailchimp for client email, Thinkific for course content, a
              Notion doc per client, a Google Sheet you don't trust. Roughly $170 a month, and the
              real cost is the 8–11 hours a week of admin that doesn't bill.
            </p>
            <p className="mt-4 text-lg text-ink-700">
              PupManager replaces the stack and the admin overhead it forces on you.
            </p>
            <div className="mt-8">
              <Link
                href="/vs/duct-tape-stack"
                className="inline-flex items-center gap-1 font-medium text-brand-700 hover:text-brand-800"
              >
                See the comparison <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
          <ImageSlot
            label="Side-by-side product shot or stack diagram (~1000×800)"
            aspect="5/4"
          />
        </div>
      </Container>
    </section>
  )
}

function FounderSection() {
  return (
    <section className="border-t border-ink-100 bg-brand-50 py-24">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <ImageSlot
            label="Founder photo, working with a dog. Real, not stock. (~1000×1000)"
            aspect="1/1"
          />
          <div>
            <p className="text-sm font-medium text-brand-700">Who's behind this</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-ink-900">
              Built next to working trainers
            </h2>
            <p className="mt-5 text-lg text-ink-700">
              {/* TODO: replace with real founder copy. The customer profile suggests
                  founder accessibility — name, face, a "why we're building this" — is
                  one of the strongest trust mechanics for this audience. */}
              We started building PupManager because the trainers we know are great at training dogs
              and tired of being half-decent secretaries. Every feature in the product traces back
              to a specific moment a trainer told us about — the 9:47 pm reschedule text, the
              Sunday afternoon Stripe reconcile, the client who quietly left because they couldn't
              see their progress.
            </p>
            <p className="mt-4 text-lg text-ink-700">
              We're a small team, we ship fast, and we answer our own email.
            </p>
            <div className="mt-8">
              <Link
                href="/about"
                className="inline-flex items-center gap-1 font-medium text-brand-700 hover:text-brand-800"
              >
                Read our story <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}

function Testimonials() {
  return (
    <section className="border-t border-ink-100 py-24">
      <Container>
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-brand-700">From the field</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-ink-900">
            What trainers are saying
          </h2>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {/* TODO: replace with real testimonials once collected. Customer profile is
              clear: real names + business names + face. No stock photos. No fabricated
              quotes — the segment will spot them instantly. */}
          {testimonialPlaceholders.map((t, i) => (
            <div key={i} className="rounded-2xl border border-ink-100 bg-white p-7">
              <p className="text-ink-900">"{t.quote}"</p>
              <div className="mt-6 flex items-center gap-3">
                <ImageSlot label="Trainer headshot" aspect="1/1" className="!h-12 !w-12 !rounded-full" />
                <div>
                  <p className="text-sm font-medium text-ink-900">{t.name}</p>
                  <p className="text-sm text-ink-500">{t.business}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}

function NewsletterSection() {
  return (
    <section className="border-t border-ink-100 bg-ink-50 py-24">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-ink-900">
            New product notes, every other Sunday
          </h2>
          <p className="mt-3 text-ink-700">
            What we shipped, what we're working on next, and one piece of trainer-business writing
            we found useful. No fluff.
          </p>
          {/* TODO: wire to Resend / Loops / ConvertKit. Stub for now. */}
          <form
            className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center"
            action="mailto:hello@pupmanager.com"
            method="post"
            encType="text/plain"
          >
            <input
              required
              type="email"
              name="email"
              placeholder="you@yourdomain.com"
              className="w-full rounded-md border border-ink-300 bg-white px-4 py-2.5 text-ink-900 placeholder:text-ink-500 focus:border-brand-600 focus:outline-none sm:max-w-xs"
            />
            <button
              type="submit"
              className="rounded-md bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700"
            >
              Subscribe
            </button>
          </form>
          <p className="mt-3 text-xs text-ink-500">No spam. Unsubscribe in one click.</p>
        </div>
      </Container>
    </section>
  )
}

function FinalCTA() {
  return (
    <section className="border-t border-ink-100 py-24">
      <Container>
        <div className="rounded-3xl bg-brand-600 px-8 py-16 text-center text-white sm:px-16">
          <h2 className="text-4xl font-semibold tracking-tight">Give Sunday night back to yourself.</h2>
          <p className="mx-auto mt-4 max-w-xl text-brand-100">
            Free 14-day trial. Concierge migration for the first 50 customers — bring us your
            exports, we'll set you up.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="https://app.pupmanager.com/signup"
              className="rounded-md bg-white px-5 py-3 font-medium text-brand-700 hover:bg-brand-50"
            >
              Try for free
            </a>
            <a
              href="mailto:hello@pupmanager.com"
              className="rounded-md border border-white/30 px-5 py-3 font-medium text-white hover:bg-white/10"
            >
              Talk to us
            </a>
          </div>
        </div>
      </Container>
    </section>
  )
}

const features = [
  {
    glyph: '01',
    title: 'Structured progress, not a Notes-app heap',
    body:
      "Each session has tasks, scores, video, notes. The client sees tonight's homework before they're home from your appointment. Show a chart at the next consult — \"look how much Riley has improved on the recall.\"",
  },
  {
    glyph: '02',
    title: 'A client app worth showing off',
    body:
      'Polished enough that prospective clients ask which gym you use. Web access for clients who won\'t install another app.',
  },
  {
    glyph: '03',
    title: "Scheduling that knows it's a session",
    body:
      'Package credits, buffer time, recurring slots, partner calendar visibility. Reschedule from one link instead of a 3-message text thread.',
  },
  {
    glyph: '04',
    title: 'Group classes, cohorts, make-ups',
    body:
      'Run a 6-week series with cohort enrollment, attendance per team in two taps, automatic make-up tracking.',
  },
]

const segments: { title: string; body: string; imageLabel: string }[] = [
  {
    title: 'Private lessons',
    body: 'In-home and facility-based. Reactivity, puppy, adolescent. The bread and butter.',
    imageLabel: 'Private-lesson shot — trainer with one client + dog',
  },
  {
    title: 'Group classes',
    body: '6-week series, cohort enrollment, attendance, make-ups. Engagement Foundations, Puppy K, Reactivity 101.',
    imageLabel: 'Group-class shot — class in session',
  },
  {
    title: 'Behavior consults',
    body: 'Longitudinal cases with structured progress, homework, and shareable case notes.',
    imageLabel: 'Consult shot — trainer + client at a kitchen table',
  },
  {
    title: 'Board-and-train',
    body: 'Daily report cards and check-in videos for clients while their dog is with you. Coming soon.',
    imageLabel: 'Board-and-train shot — dog in training, calm setting',
  },
]

const testimonialPlaceholders = [
  {
    quote:
      'Replace with a real trainer quote. Aim for 1–2 sentences. Specific beats general. "Cut my Sunday admin from three hours to twenty minutes" beats "love this product."',
    name: 'Trainer name',
    business: 'Business · City, ST',
  },
  {
    quote:
      'Real testimonial slot. Best ones name a specific pain — the 9pm reschedule, the lost client, the no-show fee. Shorter is better.',
    name: 'Trainer name',
    business: 'Business · City, ST',
  },
  {
    quote:
      'Real testimonial slot. Mix credentials (KPA, CCPDT, IAABC) into the byline if the trainer holds them — adds trust without saying it explicitly.',
    name: 'Trainer name',
    business: 'Business · City, ST',
  },
]
