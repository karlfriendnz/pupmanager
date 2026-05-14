import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/Container'

export const metadata: Metadata = {
  title: 'Roadmap',
  description:
    'What\'s live in PupManager today, what\'s shipping next, and what\'s on the roadmap. We don\'t hide gaps.',
}

type Status = 'On the roadmap' | 'Shipping soon' | 'Live'

const columns: { status: Status; blurb: string }[] = [
  { status: 'On the roadmap', blurb: "Coming soon. Tell us if you want it sooner." },
  { status: 'Shipping soon', blurb: "Almost ready. You'll see it in the next update or two." },
  { status: 'Live', blurb: "Ready to use today. Try it free for 10 days." },
]

const roadmap: { status: Status; title: string; body: string }[] = [
  {
    status: 'Live',
    title: 'Structured progress + client app',
    body: 'Sessions, tasks, video, notes, charts — and a client app worth showing off.',
  },
  {
    status: 'Live',
    title: 'Scheduling + package credits',
    body: 'One-link reschedule, recurring slots, buffer times, package tracking.',
  },
  {
    status: 'Live',
    title: 'Group-class cohorts',
    body: 'Enrollment, per-team attendance, make-up tracking across a 6-week series.',
  },
  {
    status: 'Live',
    title: 'In-app messages',
    body: 'Per-client threads with the dog\'s context next to the conversation.',
  },
  {
    status: 'Live',
    title: 'Intake forms + enquiry inbox',
    body: 'Embeddable intake forms feed straight into a triage inbox. No more Gmail-as-CRM.',
  },
  {
    status: 'Shipping soon',
    title: 'AI plan generator + progress summaries',
    body: 'Draft a 6-week plan from a behaviour brief; one-click client-facing progress write-ups. The AI does the typing — you stay in charge.',
  },
  {
    status: 'Live',
    title: 'Curriculum templates',
    body: 'Build Engagement Foundations once, run it forever — drop into any client or cohort.',
  },
  {
    status: 'Live',
    title: 'Shop, products, and packages',
    body: 'Sell sessions, packages, and add-ons from one storefront. Clients buy without a phone tag.',
  },
  {
    status: 'Live',
    title: 'Achievements',
    body: 'Milestone celebration on the client app — keeps owners motivated, sessions on the books.',
  },
  {
    status: 'Live',
    title: 'Preview-as-client',
    body: 'See your client app exactly the way the owner sees it before anyone else does.',
  },
  {
    status: 'Shipping soon',
    title: 'Stripe payment links + invoicing',
    body: "Send a Stripe payment link or an invoice straight from a session or a package. Clients pay on their own card — we don't store it. Reconciliation is automatic.",
  },
  {
    status: 'Shipping soon',
    title: 'Vaccination + waiver tracking',
    body: 'Expiry reminders, signed-doc storage, status surfaced on the client roster.',
  },
  {
    status: 'Shipping soon',
    title: 'Xero / QuickBooks integration',
    body: 'One-way sync of invoices and payments to Xero or QuickBooks — your accountant stops asking.',
  },
  {
    status: 'On the roadmap',
    title: 'Group-class waitlist promotion',
    body: 'Auto-promote from waitlist when a spot opens, with confirm/decline windows.',
  },
  {
    status: 'On the roadmap',
    title: 'Board-and-train report cards',
    body: 'Daily report cards and check-in videos for clients while their dog is with you.',
  },
  {
    status: 'On the roadmap',
    title: 'Concierge migration',
    body: 'Bring us your exports from wherever your data lives — we\'ll set up your day-1 PupManager.',
  },
]

export default function RoadmapPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-brand-50 to-white py-20">
        <Container>
          <p className="text-sm font-medium text-brand-700">What's next</p>
          <h1 className="mt-3 max-w-3xl text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
            What we&rsquo;re building. No fudging.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-700">
            What&rsquo;s ready to use. What&rsquo;s nearly there. What&rsquo;s coming. Three honest
            columns — no &ldquo;coming soon&rdquo; that means &ldquo;maybe one day.&rdquo;
          </p>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <div data-reveal className="grid gap-8 md:grid-cols-3">
            {columns.map((col) => (
              <div key={col.status} className="flex flex-col">
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      col.status === 'Live'
                        ? 'bg-brand-600'
                        : col.status === 'Shipping soon'
                        ? 'bg-accent-500'
                        : 'bg-ink-300'
                    }`}
                  />
                  <h2 className="text-xl font-semibold tracking-tight text-ink-900">
                    {col.status}
                  </h2>
                  <span className="ml-auto text-sm font-medium text-ink-500">
                    {roadmap.filter((r) => r.status === col.status).length}
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink-500">{col.blurb}</p>
                <div className="mt-6 flex flex-col gap-4">
                  {roadmap
                    .filter((r) => r.status === col.status)
                    .map((r) => (
                      <div
                        key={r.title}
                        className={`rounded-2xl border p-5 ${
                          col.status === 'Live'
                            ? 'border-brand-200/60 bg-white'
                            : col.status === 'Shipping soon'
                            ? 'border-accent-500/40 bg-accent-400/10'
                            : 'border-ink-100 bg-ink-50'
                        }`}
                      >
                        <h3 className="text-base font-semibold text-ink-900">{r.title}</h3>
                        <p className="mt-2 text-sm text-ink-700">{r.body}</p>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <div data-reveal className="rounded-3xl bg-brand-600 px-8 py-16 text-center text-white sm:px-16">
            <h2 className="text-4xl font-semibold tracking-tight">Need something we don&rsquo;t have?</h2>
            <p className="mx-auto mt-4 max-w-xl text-brand-100">
              Tell us. Most of what&rsquo;s live today started as one trainer asking us if we could
              do this one thing.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/contact"
                className="rounded-md bg-white px-5 py-3 font-medium text-brand-700 hover:bg-brand-50"
              >
                Tell us what you need
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
