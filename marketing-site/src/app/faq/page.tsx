import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/Container'
import { JsonLd } from '@/components/JsonLd'

export const metadata: Metadata = {
  title: 'FAQ',
  description:
    'Honest answers to the questions trainers actually ask: pricing, payments, vaccinations, group-class waitlists, switching from your old tools, and more.',
}

type Q = { id: string; q: string; a: React.ReactNode; aText: string }

const items: Q[] = [
  {
    id: 'what-is-pupmanager',
    q: 'What is PupManager?',
    aText:
      "PupManager is software for working dog trainers. It handles your schedule, your client notes, your homework videos, group classes, lead capture, and gives your clients a beautiful app to follow along in. It replaces the five different tools you're probably using right now.",
    a: (
      <>
        PupManager is software for working dog trainers. It handles your schedule, your client
        notes, your homework videos, group classes, lead capture, and gives your clients a
        beautiful app to follow along in. It replaces the five different tools you&rsquo;re
        probably using right now.
      </>
    ),
  },
  {
    id: 'who-is-it-for',
    q: 'Who is PupManager for?',
    aText:
      "If you train dogs for a living — on your own or in a small team — this is for you. We're built for trainers running private lessons, group classes, and behaviour consults. We're not built for daycare or boarding businesses, big multi-location chains, or hobbyists tracking their own pet.",
    a: (
      <>
        If you train dogs for a living — on your own or in a small team — this is for you.
        We&rsquo;re built for trainers running private lessons, group classes, and behaviour
        consults. We&rsquo;re <strong>not</strong> built for daycare or boarding businesses, big
        multi-location chains, or hobbyists tracking their own pet.
      </>
    ),
  },
  {
    id: 'pricing',
    q: 'How much does it cost?',
    aText:
      "US$30 per trainer per month — every feature, unlimited clients and dogs. Multi-trainer accounts are coming soon. The 10-day free trial includes every feature for up to 3 dogs (no card needed). Prices shown in AUD, NZD, GBP, CAD, USD, ZAR. No demo calls. No surprises.",
    a: (
      <>
        <strong>US$30 per trainer per month</strong> — every feature, unlimited clients and dogs.
        Multi-trainer accounts are coming soon. The 10-day free trial includes every feature for
        up to 3 dogs (no card needed). Prices in AUD / NZD / GBP / CAD / USD / ZAR. See{' '}
        <Link href="/pricing">/pricing</Link>.
      </>
    ),
  },
  {
    id: 'payments',
    q: 'Can I take payments through it?',
    aText:
      "Almost. We're connecting it to Stripe so you can send a payment link or an invoice straight from a session or a package. We don't store your clients' card details — they pay on their own card, every time. It's the next big thing we ship.",
    a: (
      <>
        <strong>Almost.</strong> We&rsquo;re connecting it to Stripe so you can send a payment
        link or an invoice straight from a session or a package. We don&rsquo;t store your
        clients&rsquo; card details — they pay on their own card, every time. It&rsquo;s the
        next big thing we ship.
      </>
    ),
  },
  {
    id: 'vaccinations',
    q: 'Does it track vaccinations and waivers?',
    aText:
      "Not yet. We're working on it — vaccination dates, signed waivers, automatic expiry reminders. It'll be ready before our public launch. If you need this today, we'll be honest with you: we're not quite there yet.",
    a: (
      <>
        <strong>Not yet.</strong> We&rsquo;re working on it — vaccination dates, signed waivers,
        automatic expiry reminders. It&rsquo;ll be ready before our public launch. If you need
        this today, we&rsquo;ll be honest with you: we&rsquo;re not quite there yet.
      </>
    ),
  },
  {
    id: 'group-classes',
    q: 'Can I run group classes?',
    aText:
      "Yes. You can run a 6-week class with everyone signed up at once, take attendance in two taps, and let catch-up sessions track themselves. Waitlists with auto-fill are coming next.",
    a: (
      <>
        <strong>Yes.</strong> You can run a 6-week class with everyone signed up at once, take
        attendance in two taps, and let catch-up sessions track themselves.{' '}
        <strong>Waitlists with auto-fill</strong> are coming next.
      </>
    ),
  },
  {
    id: 'older-clients',
    q: 'My clients are older. Will they have to download an app?',
    aText:
      "No. The app is optional. They get a simple web link instead — same homework, same videos, same reminders. They just click the link in the email. Most older clients prefer this.",
    a: (
      <>
        No. The app is optional. They get a simple web link instead — same homework, same videos,
        same reminders. They just click the link in the email. Most older clients prefer this.
      </>
    ),
  },
  {
    id: 'client-login',
    q: 'How do clients sign in?',
    aText:
      "They type in their email and we send them a one-time code. No password to remember. Trainers sign in the normal way with an email and password.",
    a: (
      <>
        They type in their email and we send them a one-time code. No password to remember.
        Trainers sign in the normal way with an email and password.
      </>
    ),
  },
  {
    id: 'switching',
    q: "I've got 60 clients in another tool. Switching sounds painful.",
    aText:
      "If you're one of our first 50 customers, we'll do the move for you. Send us your exports — wherever your data lives — and we'll set up your account so you can take a booking within an hour.",
    a: (
      <>
        If you&rsquo;re one of our first 50 customers, we&rsquo;ll <strong>do the move for you</strong>.
        Send us your exports — wherever your data lives — and we&rsquo;ll set up your account so
        you can take a booking within an hour.
      </>
    ),
  },
  {
    id: 'why-trust',
    q: "Why should I trust a new tool? I've seen products vanish before.",
    aText:
      "Fair question. A real person reads every email — usually the founder. The roadmap is on the website. The changelog is on the website. We tell you what we've built and what we haven't. If we ever quietly drop a feature, you'll know.",
    a: (
      <>
        Fair question. A real person reads every email — usually the founder. The{' '}
        <Link href="/roadmap">roadmap</Link> is on the website. The{' '}
        <Link href="/changelog">changelog</Link> is on the website. We tell you what we&rsquo;ve
        built and what we haven&rsquo;t. If we ever quietly drop a feature, you&rsquo;ll know.
      </>
    ),
  },
  {
    id: 'why-more-than-a-booking-tool',
    q: "Why is PupManager $30 when a basic booking tool is $27?",
    aText:
      "Because a booking tool is one tool — and you probably need five. Booking ($27), email ($45), course content ($99), notes (Notion), a Google Form for sign-ups — that's about $170/month. PupManager replaces all of it. And it gives you back the 8–11 hours a week you spend gluing them together.",
    a: (
      <>
        Because a booking tool is one tool — and you probably need five.{' '}
        <strong>Booking ($27) + email ($45) + course content ($99) + Notion + a Google Form</strong>{' '}
        — that&rsquo;s about $170/month. PupManager replaces all of it. And it gives you back the
        8–11 hours a week you spend gluing them together. See{' '}
        <Link href="/blog/duct-tape-stack">the comparison</Link>.
      </>
    ),
  },
  {
    id: 'methodology',
    q: "Is PupManager R+, balanced, or something else?",
    aText:
      "None of the above. PupManager is a tool — how you train is up to you. Force-free, balanced, sport, behaviour, working dogs — it works the same way. We don't make training judgements. We make admin disappear.",
    a: (
      <>
        None of the above. PupManager is a tool — how you train is up to you. Force-free,
        balanced, sport, behaviour, working dogs — it works the same way. We don&rsquo;t make
        training judgements. We make admin disappear.
      </>
    ),
  },
  {
    id: 'data-export',
    q: "Can I take my data with me if I leave?",
    aText:
      "Yes. Anytime. Your clients, sessions, progress, and homework templates can be exported as a spreadsheet. It's your data — you keep it.",
    a: (
      <>
        Yes. Anytime. Your clients, sessions, progress, and homework templates can be exported as
        a spreadsheet. It&rsquo;s your data — you keep it.
      </>
    ),
  },
  {
    id: 'where-based',
    q: "Where is PupManager based?",
    aText:
      "We're a New Zealand company. We work with trainers all over the world — most of our customers are in the US, UK, Australia, New Zealand, and Canada. We follow privacy laws in all of those places (GDPR, CCPA, Australian Privacy Principles, NZ Privacy Act 2020).",
    a: (
      <>
        We&rsquo;re a New Zealand company. We work with trainers all over the world — most of our
        customers are in the US, UK, Australia, New Zealand, and Canada. We follow privacy laws
        in all of those places. See <Link href="/privacy">/privacy</Link>.
      </>
    ),
  },
]

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.aText,
    },
  })),
}

export default function FAQPage() {
  return (
    <>
      <JsonLd data={faqSchema} />

      <section className="bg-gradient-to-b from-brand-50 to-white py-20">
        <Container className="max-w-4xl">
          <p className="text-sm font-medium text-brand-700">FAQ</p>
          <h1 className="mt-3 text-5xl font-semibold tracking-tight text-ink-900">
            Real answers. No demo call required.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-700">
            The questions trainers actually ask us — including the ones about features we
            haven&rsquo;t built yet.
          </p>
        </Container>
      </section>

      <section className="py-16">
        <Container className="max-w-3xl">
          <nav className="rounded-2xl border border-ink-100 bg-ink-50 p-6 text-sm">
            <p className="font-semibold text-ink-900">On this page</p>
            <ol className="mt-3 grid gap-2 md:grid-cols-2">
              {items.map((item, i) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} className="text-brand-700 hover:text-brand-800">
                    {i + 1}. {item.q}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-12 space-y-10">
            {items.map((item) => (
              <article
                key={item.id}
                id={item.id}
                data-reveal
                className="scroll-mt-16"
              >
                <h2 className="text-xl font-semibold tracking-tight text-ink-900">{item.q}</h2>
                <p className="mt-3 text-ink-700">{item.a}</p>
              </article>
            ))}
          </div>

          <div className="mt-16 rounded-2xl bg-brand-600 px-8 py-12 text-center text-white">
            <h2 className="text-2xl font-semibold tracking-tight">Didn&rsquo;t see your question?</h2>
            <p className="mt-3 text-brand-100">
              Email <a href="mailto:info@pupmanager.com" className="underline">info@pupmanager.com</a>{' '}
              or use <Link href="/contact" className="underline">the contact form</Link>. A real
              person replies — usually the same day.
            </p>
          </div>
        </Container>
      </section>
    </>
  )
}
