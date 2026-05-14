import Link from 'next/link'
import Image from 'next/image'
import { Container } from './Container'

const groups: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/features', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/roadmap', label: 'Roadmap' },
      { href: '/changelog', label: 'Changelog' },
      { href: '/faq', label: 'FAQ' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/blog', label: 'Blog' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
]

export function Footer() {
  return (
    <footer className="mt-32 border-t border-ink-100 bg-ink-50">
      <Container className="py-16">
        <div className="grid gap-12 md:grid-cols-5">
          <div>
            <Link href="/" aria-label="PupManager" className="inline-flex">
              <Image
                src="/wordmark.png"
                alt="PupManager"
                width={5247}
                height={966}
                sizes="(max-width: 640px) 200px, 220px"
                className="h-10 w-auto sm:h-8"
              />
            </Link>
            <p className="mt-4 max-w-xs text-sm text-ink-700">
              Software for dog trainers. Made by people who get it.
            </p>
          </div>

          {groups.map((g) => (
            <div key={g.title}>
              <h3 className="text-sm font-semibold text-ink-900">{g.title}</h3>
              <ul className="mt-4 space-y-2 text-sm">
                {g.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-ink-700 hover:text-ink-900">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="flex flex-col gap-2 md:items-end">
            <a href="#" aria-label="Download on the App Store" className="inline-flex">
              <Image
                src="/app-store-badge.svg"
                alt="Download on the App Store"
                width={135}
                height={45}
                className="h-[45px] w-auto"
              />
            </a>
            <a href="#" aria-label="Get it on Google Play" className="inline-flex">
              <Image
                src="/google-play-badge.svg"
                alt="Get it on Google Play"
                width={135}
                height={45}
                className="h-[45px] w-auto"
              />
            </a>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-ink-100 pt-6 text-sm text-ink-500 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} PupManager. Made for trainers.</p>
        </div>
      </Container>
    </footer>
  )
}
