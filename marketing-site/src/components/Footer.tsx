import Link from 'next/link'
import { Container } from './Container'

export function Footer() {
  return (
    <footer className="border-t border-ink-300/40 mt-24 py-10 text-sm text-ink-500">
      <Container className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <p>© {new Date().getFullYear()} PupManager</p>
        <nav className="flex gap-6">
          <Link href="/pricing" className="hover:text-ink-900">Pricing</Link>
          <Link href="/blog" className="hover:text-ink-900">Blog</Link>
          <a href="mailto:hello@pupmanager.com" className="hover:text-ink-900">Contact</a>
        </nav>
      </Container>
    </footer>
  )
}
