import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/Container'

export const metadata: Metadata = {
  title: 'Changelog',
  description:
    "What we shipped and when. We don't hide gaps — see the roadmap for what's next.",
}

type Tag = 'Feature' | 'Improvement' | 'Fix'

const entries: { date: string; title: string; tag: Tag; body: string }[] = [
  {
    date: '2026-05-09',
    title: 'New marketing site',
    tag: 'Feature',
    body:
      "Rebuilt /features around the real product — five categories, a card on the home page for each, and an honest /roadmap kanban. Added a 6-currency pricing page and a comparison post at /blog/duct-tape-stack. Privacy-conscious analytics and a cookie notice in place too.",
  },
  {
    date: '2026-05-08',
    title: 'In-app messaging with dog context',
    tag: 'Feature',
    body:
      "Per-client threads now sit beside the dog's history, last session, and tonight's homework. Stop digging through three apps to find what Riley's mum told you.",
  },
  {
    date: '2026-05-08',
    title: 'Embeddable intake forms + enquiries inbox',
    tag: 'Feature',
    body:
      "Drag-and-drop form builder, embed on your site or share a link. New leads land in a triage inbox you can convert to a client in one click.",
  },
  {
    date: '2026-05-08',
    title: 'Achievements in the client app',
    tag: 'Feature',
    body:
      "Auto-awarded milestones for first recall on cue, first month of consistency, graduation from a 6-week series — no extra admin from you.",
  },
]

const tagStyles: Record<Tag, string> = {
  Feature: 'bg-brand-100 text-brand-800',
  Improvement: 'bg-accent-400/30 text-ink-900',
  Fix: 'bg-ink-100 text-ink-700',
}

export default function ChangelogPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-brand-50 to-white py-20">
        <Container>
          <p className="text-sm font-medium text-brand-700">Changelog</p>
          <h1 className="mt-3 max-w-3xl text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
            What we built. When we built it.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-700">
            Every new thing we shipped — in plain English. Want to see what&apos;s next? Check the{' '}
            <Link href="/roadmap" className="font-medium text-brand-700 hover:text-brand-800">
              roadmap
            </Link>
            .
          </p>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          <ol data-reveal className="relative mx-auto max-w-3xl border-l border-ink-100 pl-8">
            {entries.map((entry) => (
              <li key={`${entry.date}-${entry.title}`} className="relative pb-12 last:pb-0">
                <span
                  className="absolute -left-[37px] top-1 grid h-4 w-4 place-items-center rounded-full border-2 border-white bg-brand-600 ring-4 ring-brand-100"
                  aria-hidden
                />
                <p className="text-sm font-medium text-ink-500">{formatDate(entry.date)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <h2 className="text-xl font-semibold tracking-tight text-ink-900">
                    {entry.title}
                  </h2>
                  <span
                    className={`rounded-full px-3 py-0.5 text-xs font-medium ${tagStyles[entry.tag]}`}
                  >
                    {entry.tag}
                  </span>
                </div>
                <p className="mt-3 text-ink-700">{entry.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <div data-reveal className="rounded-3xl bg-brand-600 px-8 py-16 text-center text-white sm:px-16">
            <h2 className="text-4xl font-semibold tracking-tight">Curious about what&rsquo;s next?</h2>
            <p className="mx-auto mt-4 max-w-xl text-brand-100">
              Have a look at the roadmap to see what&rsquo;s shipping next, or jump in and try
              the parts that are already live.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/roadmap"
                className="rounded-md bg-white px-5 py-3 font-medium text-brand-700 hover:bg-brand-50"
              >
                See the roadmap
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
