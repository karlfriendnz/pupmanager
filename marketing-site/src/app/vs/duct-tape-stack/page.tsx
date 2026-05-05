import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/Container'

export const metadata: Metadata = {
  title: 'PupManager vs. the duct-tape stack',
  description:
    'Acuity + Mailchimp + Thinkific + a Notion doc + a Google Sheet ≈ $170/mo. PupManager is $39.',
}

export default function DuctTapeStackPage() {
  return (
    <>
      <section className="pt-20 pb-12">
        <Container>
          <p className="text-sm font-medium text-brand-600">Compare</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            You're not paying for one tool. You're paying for five.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-700">
            Most working trainers run on Acuity for scheduling, Mailchimp for client email, Thinkific
            (or a Google Drive folder) for course content, a Notion doc per client, and a Google
            Sheet they don't quite trust. The math doesn't favor you.
          </p>
        </Container>
      </section>

      <section className="py-12">
        <Container>
          <div className="overflow-hidden rounded-2xl border border-ink-300/60">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-300/20 text-ink-700">
                <tr>
                  <th className="px-5 py-3 font-medium">Tool</th>
                  <th className="px-5 py-3 font-medium">What it does</th>
                  <th className="px-5 py-3 font-medium text-right">Monthly</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-300/40">
                {stack.map((row) => (
                  <tr key={row.tool}>
                    <td className="px-5 py-4 font-medium text-ink-900">{row.tool}</td>
                    <td className="px-5 py-4 text-ink-700">{row.use}</td>
                    <td className="px-5 py-4 text-right text-ink-900">{row.cost}</td>
                  </tr>
                ))}
                <tr className="bg-ink-300/10 font-medium">
                  <td className="px-5 py-4">Stack total</td>
                  <td className="px-5 py-4 text-ink-700">…and the gaps between them</td>
                  <td className="px-5 py-4 text-right">~$170</td>
                </tr>
                <tr className="bg-brand-50 font-medium">
                  <td className="px-5 py-4 text-brand-700">PupManager</td>
                  <td className="px-5 py-4 text-ink-700">All of the above. One login.</td>
                  <td className="px-5 py-4 text-right text-brand-700">$39</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-ink-500">
            Costs reflect typical paid plans for a solo trainer in 2026. Free tiers exist; the time
            you spend duct-taping them together is the bigger bill.
          </p>
        </Container>
      </section>

      <section className="border-t border-ink-300/40 py-16">
        <Container>
          <h2 className="text-3xl font-semibold tracking-tight">The math the spreadsheet doesn't show</h2>
          <p className="mt-4 max-w-3xl text-ink-700">
            The duct-tape stack costs more than $170. The real cost is the 8–11 hours a week of
            admin that doesn't bill — the post-session note-typing in your car, the Sunday-night
            Stripe reconcile, the four "what was the cue again?" texts you answer between
            appointments. At $165 a session, that's $1,300–$1,800 of unbilled labor a week.
          </p>
          <p className="mt-4 max-w-3xl text-ink-700">
            PupManager doesn't replace your training. It replaces the admin overhead the stack
            forces on you.
          </p>
        </Container>
      </section>

      <section className="border-t border-ink-300/40 py-16">
        <Container>
          <h2 className="text-3xl font-semibold tracking-tight">Side by side</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {compare.map((row) => (
              <div key={row.title} className="rounded-2xl border border-ink-300/50 p-6">
                <h3 className="font-medium text-ink-900">{row.title}</h3>
                <p className="mt-3 text-sm font-medium text-ink-500">On the duct-tape stack</p>
                <p className="mt-1 text-ink-700">{row.before}</p>
                <p className="mt-4 text-sm font-medium text-brand-700">With PupManager</p>
                <p className="mt-1 text-ink-700">{row.after}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-ink-300/40 py-16">
        <Container>
          <h2 className="text-3xl font-semibold tracking-tight">"Switching is the painful part."</h2>
          <p className="mt-4 max-w-3xl text-ink-700">
            We know. Sixty active clients on Acuity, three years of session notes scattered across
            Notion docs, a Stripe account that has to keep working through the move. For the first
            50 customers we do the migration for you — bring us your exports, we'll bring the
            clients, packages, and history into PupManager and hand you back a working day-1 setup.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="https://app.pupmanager.com/signup"
              className="rounded-md bg-brand-600 px-5 py-2.5 text-white hover:bg-brand-700"
            >
              Start free
            </a>
            <Link
              href="/pricing"
              className="rounded-md border border-ink-300 px-5 py-2.5 text-ink-900 hover:bg-ink-300/20"
            >
              See pricing
            </Link>
          </div>
        </Container>
      </section>
    </>
  )
}

const stack = [
  { tool: 'Acuity', use: 'Scheduling, package credits', cost: '$27' },
  { tool: 'Stripe', use: 'Payments (free, but transaction fees)', cost: '—' },
  { tool: 'Mailchimp', use: 'Client email + lesson recap broadcasts', cost: '$45' },
  { tool: 'Thinkific or similar', use: 'Course content, lesson library', cost: '$99' },
  { tool: 'Notion / Google Sheets', use: 'Client notes, attendance, packages', cost: '$0–$10' },
]

const compare = [
  {
    title: 'Reschedule at 9:47 pm',
    before:
      'Personal-cell text. Open Acuity on your phone, hope the calendar syncs to your partner, remember to tell the client.',
    after:
      "Client opens their app, picks a new slot from your real availability, the package credit re-applies. You don't open a tool.",
  },
  {
    title: 'Post-session admin',
    before:
      'Notes app in the car. Maybe transferred to a Google Doc later. Maybe not. Video stuck on your camera roll.',
    after:
      'Mark tasks complete in 90 seconds. Drop in the phone-shot rep. The client gets tonight\'s homework before they\'re home.',
  },
  {
    title: '"What was that cue again?"',
    before:
      'You covered it two weeks ago. You wrote it down somewhere. You can\'t find it. You retype it from memory at 10 pm.',
    after:
      'Client opens their home screen, sees the homework with the cue and the demo video you attached at the time. No text needed.',
  },
  {
    title: 'No-shows',
    before:
      'A $165 hour you can\'t get back. The "I thought it was 2 pm??" text after the fact.',
    after:
      'Card on file at booking. Reminder at -24h and -2h. The no-show fee charges per your policy and the slot frees up.',
  },
  {
    title: 'Group classes',
    before:
      'Printed roll-call sheet. Two paid Venmo, one paid Stripe, three are on a 6-week package — nobody quite remembers who\'s owed a make-up.',
    after:
      'Cohort enrollment. Attendance ticks in two taps per team. Make-ups auto-tracked.',
  },
  {
    title: 'Sunday afternoon',
    before:
      'Three hours reconciling Stripe + Venmo + Square against the sheet that hasn\'t been updated since November.',
    after:
      'Twenty minutes. Glance at the dashboard. Reply to two messages. Done.',
  },
]
