'use client'

import { signOutWithPush } from '@/lib/sign-out'

// Full-screen frame for locked-out trainers: no nav, no app chrome — just
// the subscribe screen. A locked trainer can't access the platform; the
// only ways out are subscribing (the page below) or signing out.
export function PaywallFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--pm-ink-50, #f5f8f9)' }}>
      {/* Teal banner — white wordmark + "trial ended" message. The wordmark
          asset is white, so the teal header is what makes it read. */}
      <header className="relative px-5 py-5 text-center" style={{ background: 'var(--pm-brand-600)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-wordmark.png" alt="PupManager" className="mx-auto h-8 w-auto" />
        <p className="mt-2.5 text-sm font-semibold tracking-wide text-white">
          Your trial has ended
        </p>
        <button
          onClick={() => signOutWithPush()}
          className="absolute right-5 top-5 text-sm font-medium text-white/80 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
