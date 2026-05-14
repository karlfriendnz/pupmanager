'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Container } from './Container'
import { FeatureGlyph, type FeatureIcon } from './FeatureGlyph'

type Item = {
  icon: FeatureIcon
  title: string
  body: string
  href: string
  linkLabel?: string
}

const trainerItems: Item[] = [
  {
    icon: 'calendar',
    title: 'A calendar that gets it',
    body:
      "Drive time between visits, package credits, recurring sessions. Clients reschedule with one link — no more text-message ping-pong.",
    href: '/features/dog-training-scheduling',
    linkLabel: 'See scheduling',
  },
  {
    icon: 'note',
    title: 'Notes that turn into a story',
    body:
      "Each session has tasks, scores, videos, and a quick note — not a wall of text in your phone you'll never read again.",
    href: '/features/dog-training-session-notes',
    linkLabel: 'See session notes',
  },
  {
    icon: 'class',
    title: 'Group classes, sorted',
    body:
      'Run a 6-week class with everyone signed up at once. Tick off attendance in two taps. Catch-up sessions track themselves.',
    href: '/features/dog-training-scheduling',
    linkLabel: 'See group classes',
  },
  {
    icon: 'inbox',
    title: 'Bring in new clients',
    body:
      'Drop a sign-up form on your website. Every enquiry lands in one tidy inbox you can work through whenever you have ten minutes.',
    href: '/features/dog-trainer-new-clients',
    linkLabel: 'See new-client forms',
  },
  {
    icon: 'phone',
    title: 'A client app you can show off',
    body: 'Your name. Your colours. New clients will ask which app you use.',
    href: '/features/dog-training-client-app',
    linkLabel: 'See the client app',
  },
  {
    icon: 'video',
    title: 'Works on your phone in the field',
    body:
      "Shoot a video. Drop it into tonight's homework. Send it before your next visit.",
    href: '/features/dog-training-session-notes',
    linkLabel: 'See session notes',
  },
]

const petParentItems: Item[] = [
  {
    icon: 'template',
    title: "Homework ready before you're home",
    body:
      "What to practise, with your trainer's video right there. No more 9pm \"what was that cue again?\" texts.",
    href: '/features/dog-training-client-app',
    linkLabel: 'See the client app',
  },
  {
    icon: 'chart',
    title: 'Watch your dog improve',
    body:
      'See progress over time. Replay the video your trainer shot to see what good looks like.',
    href: '/features/dog-training-client-app',
    linkLabel: 'See the client app',
  },
  {
    icon: 'calendar',
    title: 'Book the next session in seconds',
    body:
      "See your trainer's free spots and book the next session in a few taps. No phone tag.",
    href: '/features/dog-training-scheduling',
    linkLabel: 'See scheduling',
  },
  {
    icon: 'phone',
    title: "Don't want another app?",
    body:
      "You don't need one. Open the same thing in your browser — same homework, same videos, same reminders.",
    href: '/features/dog-training-client-app',
    linkLabel: 'See the client app',
  },
  {
    icon: 'bell',
    title: 'Reminders that actually help',
    body:
      "Tomorrow's session. Tonight's homework. A quick way to message your trainer back.",
    href: '/features/dog-training-client-app',
    linkLabel: 'See the client app',
  },
]

function Accordion({ items, openByDefault = -1 }: { items: Item[]; openByDefault?: number }) {
  const [open, setOpen] = useState(openByDefault)
  return (
    <ul className="mt-10 divide-y divide-ink-100">
      {items.map((item, i) => {
        const isOpen = i === open
        return (
          <li key={item.title}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? -1 : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-4 py-4 text-left"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700">
                <FeatureGlyph name={item.icon} />
              </span>
              <span className="flex-1 font-semibold text-ink-900">{item.title}</span>
              <svg
                className={`h-5 w-5 shrink-0 text-brand-600 transition-transform ${
                  isOpen ? 'rotate-180' : ''
                }`}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <div
              className={`grid overflow-hidden transition-all duration-300 ${
                isOpen ? 'grid-rows-[1fr] pb-4' : 'grid-rows-[0fr]'
              }`}
            >
              <div className="min-h-0 pl-13" style={{ paddingLeft: '3.25rem' }}>
                <p className="pr-8 text-sm leading-relaxed text-ink-700">{item.body}</p>
                <Link
                  href={item.href}
                  className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800"
                >
                  {item.linkLabel ?? 'Learn more'}
                  <span aria-hidden>→</span>
                </Link>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function WhoItsFor() {
  return (
    <section className="border-t border-ink-100 py-24">
      <Container>
        <div data-reveal className="grid gap-16 md:grid-cols-2">
          <div>
            <div className="mb-6 flex">
              <Image
                src="/for-trainers.png"
                alt="Dog trainer walking a golden retriever and capturing a video on her phone at sunset"
                width={927}
                height={927}
                sizes="160px"
                className="h-52 w-52 rounded-full object-cover"
              />
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-ink-900">For trainers</h2>
            <p className="mt-4 max-w-md text-ink-700">
              Your back office in one place — calendar, sessions, classes, and a client app
              you&rsquo;d be proud to share.
            </p>
            <Accordion items={trainerItems} />
          </div>

          <div>
            <div className="mb-6 flex">
              <Image
                src="/for-pet-parents.jpg"
                alt="Smiling pet parent watching her trainer's homework video on her phone, corgi at her side"
                width={1024}
                height={1024}
                sizes="160px"
                className="h-52 w-52 rounded-full object-cover"
              />
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-ink-900">For pet parents</h2>
            <p className="mt-4 text-ink-700">
              See tonight&rsquo;s homework, watch the video your trainer shot on the spot, and
              book the next session in a few taps. Your trainer in your pocket.
            </p>
            <Accordion items={petParentItems} />
          </div>
        </div>
      </Container>
    </section>
  )
}
