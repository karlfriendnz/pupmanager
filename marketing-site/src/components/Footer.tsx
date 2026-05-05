import Link from 'next/link'
import Image from 'next/image'
import { Container } from './Container'

const groups: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/vs/duct-tape-stack', label: 'Compare' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/blog', label: 'Blog' },
      { href: 'mailto:hello@pupmanager.com', label: 'Contact' },
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
        <div className="grid gap-12 md:grid-cols-4">
          <div>
            <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-ink-900">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600">
                <Image src="/logomark.svg" alt="" width={20} height={26} className="invert" />
              </span>
              <span>PupManager</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm text-ink-700">
              Software for working dog trainers. Built around the actual job.
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
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-ink-100 pt-6 text-sm text-ink-500 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} PupManager. Made for trainers.</p>
        </div>
      </Container>
    </footer>
  )
}
