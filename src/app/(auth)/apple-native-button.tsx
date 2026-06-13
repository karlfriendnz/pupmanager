'use client'

import { useState } from 'react'

// In-app Sign in with Apple for the iOS app (App Store Guideline 4.8 + 4).
// Uses the native ASAuthorization sheet via @capacitor-community/apple-sign-in
// — no system-browser redirect. The returned identity token is verified +
// exchanged for a session by /api/auth/apple-native. Rendered only on iOS
// (see login-form / register-form); the plugin is dynamically imported so it
// never ends up in the web bundle.
export function AppleNativeButton({ callbackUrl }: { callbackUrl?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handle() {
    setBusy(true)
    setError(null)
    try {
      const { SignInWithApple } = await import('@capacitor-community/apple-sign-in')
      const { response } = await SignInWithApple.authorize({
        clientId: 'com.pupmanager.app',
        // Ignored by the native iOS flow but required by the type; used only
        // by the Android/web fallback.
        redirectURI: 'https://app.pupmanager.com/login',
        scopes: 'email name',
      })

      const fullName = [response.givenName, response.familyName].filter(Boolean).join(' ') || undefined
      const res = await fetch('/api/auth/apple-native', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityToken: response.identityToken, fullName }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Sign in failed. Please try again.')
        return
      }
      // New / not-yet-verified Apple accounts must confirm the emailed code
      // before the app opens. The session is already minted, so once they
      // verify they continue straight to the dashboard.
      if (data.requiresVerification) {
        const email = typeof data.email === 'string' ? data.email : ''
        const next = callbackUrl ?? '/dashboard'
        window.location.href = `/verify-account?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`
        return
      }
      window.location.href = callbackUrl ?? '/dashboard'
    } catch (e) {
      // A user cancelling the sheet throws too — don't show an error for that.
      const msg = e instanceof Error ? e.message : ''
      if (!/cancel|1001/i.test(msg)) setError('Sign in failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-2">
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        type="button"
        onClick={handle}
        disabled={busy}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-black text-white text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-60"
      >
        <AppleLogo className="h-4 w-4" /> {busy ? 'Signing in…' : 'Sign in with Apple'}
      </button>
      <div className="my-2 flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-400">
        <span className="h-px flex-1 bg-slate-200" />
        or
        <span className="h-px flex-1 bg-slate-200" />
      </div>
    </div>
  )
}

function AppleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M16.365 1.43c0 1.14-.42 2.22-1.124 3.02-.85.97-2.23 1.72-3.34 1.63-.13-1.16.42-2.34 1.13-3.13.81-.92 2.18-1.6 3.34-1.62l-.01.1zM20.74 17.74c-.49 1.13-.72 1.63-1.35 2.63-.88 1.39-2.12 3.13-3.66 3.14-1.36.01-1.71-.89-3.56-.88-1.85.01-2.24.9-3.6.89-1.55-.01-2.72-1.58-3.6-2.97C2.06 16.65 1.83 12 4.12 9.5c1.04-1.13 2.66-1.83 4.18-1.83 1.55 0 2.52.85 3.79.85 1.23 0 1.98-.85 3.78-.85 1.36 0 2.81.74 3.84 2.02-3.37 1.85-2.82 6.66.93 8.05z" />
    </svg>
  )
}
