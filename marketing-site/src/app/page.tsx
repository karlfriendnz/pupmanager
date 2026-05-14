import Link from 'next/link'
import Image from 'next/image'
import { Container } from '@/components/Container'
import { ImageSlot } from '@/components/ImageSlot'
import { JsonLd } from '@/components/JsonLd'
import { WhoItsFor } from '@/components/WhoItsFor'

const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'PupManager',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, iOS, Android',
  url: 'https://pupmanager.com',
  description:
    'Software for working dog trainers — scheduling, structured progress, and a polished client app. Built for solo and small-team trainers.',
  offers: [
    {
      '@type': 'Offer',
      name: 'Free trial',
      price: '0',
      priceCurrency: 'USD',
      description: '10-day free trial — every feature, up to 3 dogs, no card required',
    },
    {
      '@type': 'Offer',
      name: 'Per trainer',
      price: '30',
      priceCurrency: 'USD',
      description:
        'US$30 per trainer per month. Unlimited clients & dogs, group classes with waitlists, branded client app, session notes, in-app messaging, sign-up forms.',
    },
  ],
  publisher: {
    '@type': 'Organization',
    name: 'PupManager',
    url: 'https://pupmanager.com',
  },
}

export default function HomePage() {
  return (
    <>
      <JsonLd data={softwareSchema} />
      <HeroSection />
      <FeatureGrid />
      <WhoItsFor />
      <ClientAppSection />
      <SegmentGrid />
      <VisionSection />
      <Testimonials />
      <FinalCTA />
    </>
  )
}

function HeroSection() {
  return (
    <section className="relative bg-gradient-to-b from-brand-50 via-white to-white pb-20 pt-12 lg:h-[900px] lg:pb-10 lg:pt-10">
      {/* Right-anchored hero photo. Spans the full height of the hero — top
          extends behind the sticky nav (-4rem), bottom anchors to the section
          bottom. Width auto-scales from height by aspect ratio. Mask gradient
          fades the left edge into the brand background. Hidden on small
          screens to keep the mobile hero clean. */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 top-[-4rem] hidden lg:block"
      >
        <Image
          src="/hero-bg.png"
          alt=""
          width={2381}
          height={1536}
          priority
          sizes="80vw"
          className="h-full w-auto max-w-none object-cover [mask-image:linear-gradient(to_left,black_40%,transparent_100%)]"
        />
      </div>

      {/* Soft brand glow centered behind the foreground image */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[55%] h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-200/35 blur-3xl"
      />
      {/* Subtle accent top-left */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-20 -top-10 h-72 w-72 rounded-full bg-brand-100/40 blur-2xl"
      />

      <Container className="relative lg:h-full">
        <div className="mx-auto flex max-w-5xl flex-col items-center text-center lg:h-full lg:justify-center pb-20">
          <h1 className="mx-auto max-w-4xl text-[2.5rem] font-semibold leading-[1.05] tracking-tight text-ink-900 sm:text-5xl lg:text-6xl mt-20">
            You're great at training dogs.
            <span className="mt-3 block text-2xl text-ink-500 sm:text-3xl lg:text-4xl">
              We'll handle the rest.
            </span>
          </h1>

          {/* Hero image — illustration ships with the dog-at-laptop polaroid
              baked in. Sized to fit the 900px hero; bump max-w to grow it. */}
          <div className="mx-auto mt-2 w-full max-w-3xl">
            <Image
              src="/hero-illustration.png"
              alt="PupManager trainer dashboard and client app — today's sessions, schedule, and progress"
              width={832}
              height={539}
              priority
              sizes="(max-width: 1024px) 100vw, 768px"
              className="h-auto w-full"
            />
          </div>

          <p className="mx-auto mt-8 max-w-2xl text-base leading-relaxed text-ink-700 lg:text-lg">
            One place for your schedule, your sessions, your client notes, and a beautiful app
            for your clients. So you can spend more time with the dogs and less time juggling tabs.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://app.pupmanager.com/register"
              className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-brand-600/20 transition hover:bg-brand-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              Try for free
            </a>
            <Link
              href="/blog/duct-tape-stack"
              className="inline-flex items-center justify-center rounded-lg border border-ink-300 bg-white px-6 py-3 text-sm font-semibold text-ink-900 transition hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 focus-visible:ring-offset-2"
            >
              See what it replaces
            </Link>
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
        <div data-reveal>
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-brand-700">What you get</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-ink-900">
              Built for the actual job.
            </h2>
            <p className="mt-4 text-lg text-ink-700">
              Most trainer software is really kennel software with a training tab squeezed in.
              We did it the other way around — training first, everything else around it.
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
        </div>
      </Container>
    </section>
  )
}

function ClientAppSection() {
  return (
    <section id="client-app" className="border-t border-ink-100 bg-brand-50 py-24">
      <Container>
        <div data-reveal className="grid items-center gap-12 md:grid-cols-12">
          <div className="md:col-span-7 lg:col-span-8">
            <p className="text-sm font-medium text-brand-700">What your clients see</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-ink-900">
              An app your clients and your dogs will love!
            </h2>
            <p className="mt-5 text-lg text-ink-700">
              Your client opens it, sees what to work on this week, plays the video you sent,
              ticks it off, and writes back. It looks great — the kind of great that makes new
              clients ask which app you use.
            </p>

            <ul className="mt-8 space-y-5">
              {clientAppBenefits.map((b) => (
                <li key={b.title} className="flex gap-4">
                  <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                  <div>
                    <p className="font-medium text-ink-900">{b.title}</p>
                    <p className="mt-1 text-sm text-ink-700">{b.body}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-10">
              <a
                href="https://app.pupmanager.com/register"
                className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-brand-600/20 transition hover:bg-brand-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              >
                Try it free
              </a>
            </div>
          </div>

          <div className="flex justify-center md:col-span-5 lg:col-span-4 lg:justify-end">
            <div className="relative w-full sm:w-auto md:w-full lg:w-auto">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-8 rounded-[3rem] bg-gradient-to-br from-brand-200/60 to-brand-400/30 blur-2xl"
              />
              <Image
                src="/client-app-phone-v4.png"
                alt="PupManager client app on a phone — today's homework, today's sessions, view progress"
                width={1654}
                height={2308}
                sizes="(max-width: 640px) 80vw, (max-width: 768px) 300px, (max-width: 1024px) 42vw, 380px"
                className="relative mx-auto h-auto w-4/5 sm:mx-0 sm:w-[300px] md:w-full lg:w-[360px]"
              />
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}

function SegmentGrid() {
  return (
    <section className="border-t border-ink-100 bg-ink-50 py-24">
      <Container>
        <div data-reveal>
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-brand-700">Who it's for</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-ink-900">
              Made for working dog trainers.
            </h2>
            <p className="mt-4 text-lg text-ink-700">
              On your own or part of a small team. Private lessons, group classes, behaviour
              consults. If you train dogs for a living, this is for you.
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
        </div>
      </Container>
    </section>
  )
}

function VisionSection() {
  return (
    <section className="border-t border-ink-100 py-24">
      <Container>
        <div data-reveal className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-brand-700">One tool, not five</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-ink-900">
              One app. Replaces five.
            </h2>
            <p className="mt-5 text-lg text-ink-700">
              Most trainers use a different tool for scheduling, emails, lesson notes, homework,
              and a few more besides. We do all of that in one place — built the way you actually
              work.
            </p>
            <p className="mt-4 text-lg text-ink-700">
              One login. One bill. And way more time for the dogs.
            </p>
            <div className="mt-8">
              <Link
                href="/blog/duct-tape-stack"
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

function Testimonials() {
  return (
    <section className="border-t border-ink-100 bg-brand-50/50 py-24">
      <Container>
        <div data-reveal className="mx-auto max-w-3xl">
          <div className="text-center">
            <p className="text-sm font-medium text-brand-700">In their words</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-ink-900">
              From the trainer who runs on it every day.
            </h2>
          </div>

          <figure className="mt-14 rounded-3xl border border-ink-100 bg-white p-8 shadow-sm shadow-ink-900/5 sm:p-12">
            {/* TODO: drop in Brooke's actual quote when we have it. */}
            <blockquote className="text-2xl leading-snug tracking-tight text-ink-900 sm:text-3xl">
              &ldquo;[Brooke&rsquo;s testimonial — short, specific, in her own words. Will go here once she&rsquo;s written it.]&rdquo;
            </blockquote>
            <figcaption className="mt-8 flex items-center gap-4">
              <ImageSlot
                label="Brooke headshot — Paws and Thrive"
                aspect="1/1"
                className="!h-14 !w-14 !rounded-full"
              />
              <div>
                <p className="font-semibold text-ink-900">Brooke</p>
                <p className="text-sm text-ink-500">
                  Founder,{' '}
                  <a
                    href="https://pawsandthrive.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand-700 hover:text-brand-800"
                  >
                    Paws and Thrive
                  </a>{' '}
                  · First PupManager customer
                </p>
              </div>
            </figcaption>
          </figure>

          <p className="mt-6 text-center text-sm text-ink-500">
            More trainer stories coming as we onboard our first 50.
          </p>
        </div>
      </Container>
    </section>
  )
}

function FinalCTA() {
  return (
    <section className="border-t border-ink-100 py-24">
      <Container>
        <div className="rounded-3xl bg-brand-600 px-8 py-16 text-center text-white sm:px-16" data-reveal>
          <h2 className="text-4xl font-semibold tracking-tight">More time with the dogs.</h2>
          <p className="mx-auto mt-4 max-w-xl text-brand-100">
            10 days free. No card needed. If you&apos;re one of our first 50 trainers, we&apos;ll
            even move your data over for you.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="https://app.pupmanager.com/register"
              className="rounded-md bg-white px-5 py-3 font-medium text-brand-700 hover:bg-brand-50"
            >
              Try for free
            </a>
            <Link
              href="/contact"
              className="rounded-md border border-white/30 px-5 py-3 font-medium text-white hover:bg-white/10"
            >
              Talk to us
            </Link>
          </div>
        </div>
      </Container>
    </section>
  )
}

const features = [
  {
    glyph: '01',
    title: 'Real notes that turn into a story.',
    body:
      "Each session has tasks, scores, a quick note, and the video you shot. The client sees what to work on tonight before they're home. Two weeks in, you can show them a chart of how much their dog has improved.",
  },
  {
    glyph: '02',
    title: 'An app your clients will actually use.',
    body:
      'It looks great. Your name, your colours, on their phone. There&apos;s also a web version for clients who don&apos;t want to download another app.',
  },
  {
    glyph: '03',
    title: 'Scheduling that just works.',
    body:
      'Package credits, drive time between visits, recurring slots, and a calendar your partner can see too. Clients reschedule with one link — no more text-message ping-pong.',
  },
  {
    glyph: '04',
    title: 'Group classes, sorted.',
    body:
      'Run a 6-week class with everyone signed up in one go. Tick off attendance in two taps. Catch-up sessions track themselves.',
  },
]

const clientAppBenefits: { title: string; body: string }[] = [
  {
    title: 'Homework ready before they get home.',
    body: 'Each task with a score, a quick note, and the video you shot on the spot.',
  },
  {
    title: 'Your video, in their pocket.',
    body: 'No more 9pm "what was that cue again?" messages.',
  },
  {
    title: 'Your name. Your colours.',
    body: 'Clients see your business — not ours. The reputation is yours.',
  },
  {
    title: 'iPhone, Android, or just a web link.',
    body: "Some clients won't download another app. They get a link instead. Same experience.",
  },
]

const segments: { title: string; body: string; imageLabel: string }[] = [
  {
    title: 'Private lessons',
    body: 'One-on-one work — at home or at your space. Puppies, teenagers, the dog who barks at every cyclist. Your bread and butter.',
    imageLabel: 'Private-lesson shot — trainer with one client + dog',
  },
  {
    title: 'Group classes',
    body: '6-week classes with the booking, attendance, and homework already sorted. You show up and teach.',
    imageLabel: 'Group-class shot — class in session',
  },
  {
    title: 'Behaviour consults',
    body: 'For the longer cases. Keep notes, send homework, and share clean reports your client can hand to their vet.',
    imageLabel: 'Consult shot — trainer + client at a kitchen table',
  },
  {
    title: 'Board-and-train',
    body: 'Daily updates and check-in videos so the family at home stays in the loop while the dog stays with you. Coming soon.',
    imageLabel: 'Board-and-train shot — dog in training, calm setting',
  },
]

