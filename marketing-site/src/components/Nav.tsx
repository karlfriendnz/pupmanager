import Link from 'next/link'
import { Container } from './Container'

const links = [
  { href: '/vs/duct-tape-stack', label: 'Compare' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/blog', label: 'Blog' },
]

export function Nav() {
  return (
    <header className="border-b border-ink-300/40 bg-white/80 backdrop-blur sticky top-0 z-10">
      <Container className="flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-white">P</span>
          <span>PupManager</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-ink-700 hover:text-ink-900">
              {l.label}
            </Link>
          ))}
          <a
            href="https://app.pupmanager.com/login"
            className="rounded-md bg-ink-900 px-3 py-1.5 text-white hover:bg-ink-700"
          >
            Sign in
          </a>
        </nav>
      </Container>
    </header>
  )
}
