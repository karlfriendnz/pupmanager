import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/Container'
import { ImageSlot } from '@/components/ImageSlot'
import { categories, sections } from '@/lib/features'

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Everything a working dog trainer needs in one place — your daily flow, the training itself, your clients, growing your business, and team admin.',
}

export default function FeaturesPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-brand-50 to-white py-20">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-brand-700">Features</p>
              <h1 className="mt-3 text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
                Dog training software for the way you actually work.
              </h1>
              <p className="mt-6 max-w-xl text-lg text-ink-700">
                Pick a category to dig in. Every feature here started as something a real trainer
                asked for — no fluff, no fake modules, no &ldquo;coming soon&rdquo; that means
                &ldquo;maybe one day.&rdquo;
              </p>
            </div>
            <ImageSlot
              label="Hero shot — trainer dashboard + client app side by side (~1000×800)"
              aspect="5/4"
              className="rounded-3xl"
            />
          </div>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          <div data-reveal className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {categories.map((cat) => {
              const items = sections.filter((s) => s.category === cat.id)
              return (
                <Link
                  key={cat.id}
                  href={`/features/${cat.id}`}
                  className="group relative flex flex-col overflow-hidden rounded-3xl border border-ink-100 bg-white transition-all hover:-translate-y-1 hover:border-brand-200 hover:shadow-xl hover:shadow-brand-600/10"
                >
                  {cat.comingSoon && (
                    <span className="absolute right-4 top-4 z-10 rounded-full bg-accent-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
                      Coming soon
                    </span>
                  )}

                  <ImageSlot
                    label={`${cat.eyebrow} — illustrative shot (~800×500)`}
                    aspect="16/10"
                    className="!rounded-none border-0 border-b border-ink-100"
                  />

                  <div className="flex flex-1 flex-col p-8">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-500">
                      {cat.eyebrow}
                    </p>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink-900 group-hover:text-brand-700">
                      {cat.title}
                    </h2>
                    <p className="mt-3 text-ink-700">{cat.shortBlurb}</p>

                    <ul className="mt-6 space-y-2 text-sm text-ink-700">
                      {items.map((s) => (
                        <li key={s.id} className="flex items-start gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />
                          <span>{s.eyebrow}</span>
                        </li>
                      ))}
                    </ul>

                    <p className="mt-8 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                      Have a look
                      <span aria-hidden className="transition-transform group-hover:translate-x-1">
                        →
                      </span>
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
        </Container>
      </section>

      <ComparisonTable />

      <section className="py-24">
        <Container>
          <div data-reveal className="rounded-3xl bg-brand-600 px-8 py-16 text-center text-white sm:px-16">
            <h2 className="text-4xl font-semibold tracking-tight">Try it on your own clients.</h2>
            <p className="mx-auto mt-4 max-w-xl text-brand-100">
              10 days free. No card. We&apos;ll set up a starter template so you can be booking
              sessions within an hour.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href="https://app.pupmanager.com/register"
                className="rounded-md bg-white px-5 py-3 font-medium text-brand-700 hover:bg-brand-50"
              >
                Try for free
              </a>
              <Link
                href="/pricing"
                className="rounded-md border border-white/30 px-5 py-3 font-medium text-white hover:bg-white/10"
              >
                See pricing
              </Link>
            </div>
          </div>
        </Container>
      </section>
    </>
  )
}

function ComparisonTable() {
  // 'kind-of' = some way to fake it (spreadsheet hack, WhatsApp pinning, etc).
  const rows: { label: string; without: 'no' | 'kind-of'; pup: 'yes' }[] = [
    { label: 'Log sessions in two taps',          without: 'kind-of', pup: 'yes' },
    { label: 'Branded client app',                without: 'no',      pup: 'yes' },
    { label: 'Dog profiles with full history',    without: 'kind-of', pup: 'yes' },
    { label: 'Per-task scoring + charts',         without: 'no',      pup: 'yes' },
    { label: 'Reusable class plans',              without: 'no',      pup: 'yes' },
    { label: 'Group classes + attendance',        without: 'kind-of', pup: 'yes' },
    { label: 'Sign-up forms on your website',     without: 'no',      pup: 'yes' },
    { label: 'New-enquiry inbox',                 without: 'kind-of', pup: 'yes' },
    { label: 'Per-client messaging',              without: 'kind-of', pup: 'yes' },
    { label: 'Achievements + milestones',         without: 'no',      pup: 'yes' },
    { label: 'Works on your phone in the field',  without: 'kind-of', pup: 'yes' },
  ]

  return (
    <section className="bg-ink-50 py-24">
      <Container>
        <div data-reveal className="mx-auto max-w-3xl text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-ink-900">
            Why switch to PupManager?
          </h2>
          <p className="mt-4 text-lg text-ink-700">
            Quick look at the difference.
          </p>
        </div>

        <div data-reveal className="mt-14 overflow-x-auto">
          <table className="mx-auto w-full max-w-4xl border-separate border-spacing-x-3 border-spacing-y-1 text-left">
            <thead>
              <tr>
                <th className="w-2/5 px-2 pb-6" />
                <th className="px-6 pb-6 text-center align-bottom">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-ink-100 text-2xl" aria-hidden>
                    📋
                  </div>
                  <div className="mt-3 text-base font-semibold text-ink-900">Without PupManager</div>
                  <div className="mt-1 text-xs text-ink-500">Spreadsheets, WhatsApp, no real system</div>
                </th>
                <th className="px-6 pb-6 text-center align-bottom">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-emerald-100 text-2xl text-emerald-700" aria-hidden>
                    🐾
                  </div>
                  <div className="mt-3 text-base font-semibold text-emerald-700">With PupManager</div>
                  <div className="mt-1 text-xs text-emerald-700/80">One tool. Built for trainers.</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.label} className={i % 2 === 0 ? 'bg-white' : 'bg-ink-50/60'}>
                  <td className="rounded-l-xl px-5 py-5 text-sm font-medium text-ink-900">
                    {row.label}
                  </td>
                  <td className="px-6 py-5 text-center">
                    <Cell value={row.without} />
                  </td>
                  <td className="rounded-r-xl bg-emerald-50/70 px-6 py-5 text-center">
                    <Cell value={row.pup} highlight />
                  </td>
                </tr>
              ))}
              <tr className="bg-white">
                <td className="rounded-l-xl px-5 py-6 text-sm font-medium text-ink-900">
                  Set-up time
                </td>
                <td className="px-6 py-6 text-center text-sm text-ink-700">Hours</td>
                <td className="rounded-r-xl bg-emerald-50/70 px-6 py-6 text-center text-sm font-semibold text-emerald-700">
                  10 minutes
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p data-reveal className="mt-10 text-center text-sm text-ink-500">
          Want the full breakdown?{' '}
          <Link href="/blog/duct-tape-stack" className="font-medium text-brand-700 hover:text-brand-800">
            Read the comparison post →
          </Link>
        </p>
      </Container>
    </section>
  )
}

function Cell({ value, highlight }: { value: 'yes' | 'no' | 'kind-of'; highlight?: boolean }) {
  if (value === 'yes') {
    return (
      <span
        className={`inline-grid h-8 w-8 place-items-center rounded-full ${
          highlight ? 'bg-emerald-600 text-white' : 'bg-emerald-500 text-white'
        }`}
        aria-label="Yes"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    )
  }
  if (value === 'no') {
    return (
      <span className="inline-block text-rose-500" aria-label="No">
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M5.7 4.3a1 1 0 0 0-1.4 1.4L8.6 10l-4.3 4.3a1 1 0 1 0 1.4 1.4L10 11.4l4.3 4.3a1 1 0 0 0 1.4-1.4L11.4 10l4.3-4.3a1 1 0 0 0-1.4-1.4L10 8.6 5.7 4.3Z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    )
  }
  // kind-of — you can fake it but it's painful
  return (
    <span className="text-xs font-medium text-ink-500" aria-label="Kind of, with effort">
      Kind of
    </span>
  )
}
