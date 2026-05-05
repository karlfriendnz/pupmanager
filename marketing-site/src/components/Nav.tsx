import Link from 'next/link'
import Image from 'next/image'
import { Container } from './Container'

const links = [
  { href: '/#features', label: 'Features' },
  { href: '/vs/duct-tape-stack', label: 'Compare' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
  { href: '/blog', label: 'Blog' },
]

export function Nav() {
  return (
    <header className="border-b border-ink-100 bg-white/80 backdrop-blur sticky top-0 z-10">
      <Container className="flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-ink-900">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600">
            <Image src="/logomark.svg" alt="" width={20} height={26} className="invert" priority />
          </span>
          <span className="text-lg">PupManager</span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-ink-700 hover:text-ink-900">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="https://app.pupmanager.com/login"
            className="hidden text-sm text-ink-700 hover:text-ink-900 md:block"
          >
            Sign in
          </a>
          <a
            href="https://app.pupmanager.com/signup"
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Try for free
          </a>
        </div>
      </Container>
    </header>
  )
}
