'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { Container } from './Container'

type FeatureLink = { href: string; label: string; sub: string; comingSoon?: boolean }

const featureLinks: FeatureLink[] = [
  {
    href: '/features/dog-training-scheduling',
    label: 'Scheduling',
    sub: 'Calendar, group classes, dashboard',
  },
  {
    href: '/features/dog-training-session-notes',
    label: 'Session notes',
    sub: 'Notes, scoring (AI drafts coming soon)',
  },
  {
    href: '/features/dog-training-client-app',
    label: 'Client app',
    sub: 'Your branded app, messages, badges',
  },
  {
    href: '/features/dog-trainer-new-clients',
    label: 'New clients',
    sub: 'Sign-up forms (shop coming soon)',
  },
  {
    href: '/features/dog-training-team-management',
    label: 'Team admin',
    sub: 'Multi-trainer setup',
    comingSoon: true,
  },
]

const otherLinks = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
  { href: '/blog', label: 'Blog' },
  { href: '/contact', label: 'Contact' },
]

export function Nav() {
  return (
    <header className="border-b border-ink-100 bg-white/80 backdrop-blur sticky top-0 z-20">
      <Container className="flex h-16 items-center justify-between gap-3">
        <Link href="/" aria-label="PupManager" className="flex shrink-0 items-center">
          <Image
            src="/wordmark.png"
            alt="PupManager"
            width={5247}
            height={966}
            priority
            sizes="(max-width: 640px) 130px, 160px"
            className="h-7 w-auto"
          />
        </Link>

        <nav className="hidden items-center gap-7 text-sm md:flex">
          <FeaturesDropdown />
          {otherLinks.map((l) => (
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
            href="https://app.pupmanager.com/register"
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Try for free
          </a>
        </div>
      </Container>
    </header>
  )
}

function FeaturesDropdown() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-ink-700 hover:text-ink-900"
      >
        Features
        <svg
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-1/2 top-full z-30 w-72 -translate-x-1/2 pt-3"
        >
          <div className="rounded-2xl border border-ink-100 bg-white p-2 shadow-xl shadow-ink-900/10">
            <Link
              href="/features"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-xl px-4 py-3 hover:bg-ink-50"
            >
              <p className="text-sm font-semibold text-ink-900">All features</p>
              <p className="mt-0.5 text-xs text-ink-500">The whole tour, in one place.</p>
            </Link>

            <div className="my-1 border-t border-ink-100" />

            <ul className="space-y-0.5">
              {featureLinks.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="block rounded-xl px-4 py-2.5 hover:bg-brand-50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink-900">{l.label}</span>
                      {l.comingSoon && (
                        <span className="rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-500">
                          Soon
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">{l.sub}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
