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
            I built PupManager so my wife could give her clients the service she always wanted to.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-700">
            One tool that knows you&rsquo;re a trainer — not a duct-tape stack of five that don&rsquo;t.
          </p>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <div className="grid items-start gap-12 lg:grid-cols-2" data-reveal>
            <ImageSlot
              label="Founder portrait, real working setting (~1200×1500)"
              aspect="4/5"
            />
            <div className="space-y-5 text-lg text-ink-700">
              <p>
                My wife is a working dog trainer. She&rsquo;s brilliant at it — the kind of brilliant
                that means clients drive across town and across the country to book her. She is
                significantly less brilliant at the other thing she has to do, which is run her
                training business out of a booking app, Stripe, a Notion doc per client, a Google
                Sheet, and Mailchimp. Nobody is brilliant at that, because it isn&rsquo;t a job —
                it&rsquo;s six jobs glued together with text reminders.
              </p>
              <p>
                The thing that finally got under my skin wasn&rsquo;t the lost hours. It was
                watching her come home stressed about her clients. Not because the dogs weren&rsquo;t
                progressing — the dogs were doing brilliantly. She was stressed because she
                couldn&rsquo;t give the people the service and follow-up she wanted to. The video
                she meant to send on Tuesday. The check-in she meant to do mid-week. The progress
                summary the client deserved. None of it was getting out of her head and into their
                inbox, because the admin was eating the time it would take to deliver it.
              </p>
              <p>
                That gap — between the trainer she was for the dogs and the trainer she could be
                for the clients — was where I started building. PupManager is the product I wished
                she had: the schedule, the homework, the video, the client app, and the
                progress story all in the same place, so the follow-up takes ten minutes instead
                of an hour. Once it was working for her, her trainer friends started asking when
                they could use it.
              </p>
              <p>
                We&rsquo;re a small team. We ship fast, we answer our own email, and we don&rsquo;t
                pick sides in the methodology arguments. The goal is simple: every hour we move
                out of admin is an hour she can spend doing what she actually loves — and an hour
                her clients get back as the service they were promised.
              </p>
            </div>
          </div>
        </Container>
      </section>

      <section className="relative overflow-hidden border-t border-ink-100 bg-gradient-to-b from-brand-50 via-white to-white py-24">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 top-20 h-72 w-72 rounded-full bg-accent-400/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 bottom-10 h-72 w-72 rounded-full bg-brand-200/40 blur-3xl"
        />

        <Container className="relative">
          <div data-reveal>
            <div className="max-w-3xl">
              <p className="inline-flex items-center gap-2 rounded-full bg-accent-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-accent-500">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
                House rules
              </p>
              <h2 className="mt-5 text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
                Six things you can <span className="text-brand-600">always count on.</span>
              </h2>
              <p className="mt-5 max-w-2xl text-lg text-ink-700">
                These are the rules we live by. Plain English, no fine print.
              </p>
            </div>

            <ul className="mt-16 grid gap-6 md:grid-cols-2">
              {values.map((v, i) => (
                <li
                  key={v.title}
                  className={`group relative overflow-hidden rounded-3xl border p-8 transition-shadow hover:shadow-xl hover:shadow-ink-900/5 ${
                    v.tone === 'brand'
                      ? 'border-brand-200/60 bg-white'
                      : 'border-accent-500/30 bg-white'
                  }`}
                >
                  <div className="flex items-start gap-5">
                    <span
                      className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-xl font-bold tracking-tight ${
                        v.tone === 'brand'
                          ? 'bg-brand-600 text-white'
                          : 'bg-accent-500 text-white'
                      }`}
                      aria-hidden
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <h3 className="text-2xl font-semibold tracking-tight text-ink-900">
                        {v.title}
                      </h3>
                      <p className="mt-3 text-ink-700">{v.body}</p>
                      <p
                        className={`mt-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] ${
                          v.tone === 'brand' ? 'text-brand-700' : 'text-accent-500'
                        }`}
                      >
                        <span aria-hidden>↳</span> {v.proof}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <div className="rounded-3xl bg-brand-600 px-8 py-14 text-center text-white sm:px-16" data-reveal>
            <h2 className="text-3xl font-semibold tracking-tight">Want to hear how we're thinking?</h2>
            <p className="mx-auto mt-3 max-w-xl text-brand-100">
              Email <a href="mailto:info@pupmanager.com" className="underline">info@pupmanager.com</a>{' '}
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
                href="https://app.pupmanager.com/register"
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

const values: { title: string; body: string; proof: string; tone: 'brand' | 'accent' }[] = [
  {
    tone: 'accent',
    title: 'We treat your dog like ours.',
    body:
      "When you email us, a real person reads it. Usually the same day. We care about the dog you're writing about like it lives in our house. No robots. No press-one-for-sales. Just people who actually want to help.",
    proof: 'Real people. Real replies. Same day, most days.',
  },
  {
    tone: 'brand',
    title: "We're not a side project.",
    body:
      "This is the only thing we do. We're building the best software in the world for dog trainers — not a bonus feature stuck onto something else. One job. We do it well, or we don't go home.",
    proof: 'One job. We take it seriously.',
  },
  {
    tone: 'brand',
    title: "The price is the price.",
    body:
      "You shouldn't have to fill out a form to find out what something costs. Our prices are right there on the page, in your money, with nothing hidden. No surprises. No tricks.",
    proof: 'Six currencies. No "talk to sales" button.',
  },
  {
    tone: 'accent',
    title: "We listen. A lot.",
    body:
      "Every part of PupManager started as something a trainer asked for. Sometimes over coffee. Sometimes in a message at 11pm. We listen, we build it, then we come back and ask what's next. That's the whole loop.",
    proof: 'Every feature has a name behind it.',
  },
  {
    tone: 'brand',
    title: "We tell the truth, even the awkward bits.",
    body:
      "If we haven't built something yet, we say so. If we're working on it, we say that too. No fake screenshots. No \"coming soon\" that means \"maybe one day.\" You'll always know exactly where we're at.",
    proof: 'See the roadmap. Three honest columns.',
  },
  {
    tone: 'accent',
    title: "We make you look good.",
    body:
      "When your client opens the app, they see your name on it — not ours. So we sweat every detail, because the way it looks reflects on you. If you'd be proud to show it off, we did our job.",
    proof: "Your name. Your colours. Our pixels.",
  },
]
