'use client'

import { signOutWithPush } from '@/lib/sign-out'

// Full-screen frame for trainers who still need to finish their business
// profile (name + business name + phone). No nav, no app chrome — the only
// ways forward are completing the form below or signing out. Mirrors
// PaywallFrame so the two hard gates look and behave consistently.
export function CompleteProfileFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--pm-ink-50, #f5f8f9)' }}>
      <header className="relative px-5 py-5 text-center" style={{ background: 'var(--pm-brand-600)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-wordmark.png" alt="PupManager" className="mx-auto h-8 w-auto" />
        <p className="mt-2.5 text-sm font-semibold tracking-wide text-white">
          One last step
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
