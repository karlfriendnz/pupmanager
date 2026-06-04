'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'

export function InviteFlow({
  token,
  email,
  accentColor = null,
  ctaLabel = 'Create my account',
  callbackUrl = '/home',
}: {
  token: string
  email: string
  accentColor?: string | null
  ctaLabel?: string
  /** Where to land after sign-in — /home for clients, /dashboard for team. */
  callbackUrl?: string
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState<false | 'password' | 'link'>(false)
  const [error, setError] = useState<string | null>(null)

  // Accept the invite (validate + consume the one-time token) AND establish the
  // session in one step. Passing a password also stores it so they can sign in
  // with email + password later (e.g. in the native app); omitting it leaves
  // magic-link sign-in as the backup.
  async function accept(withPassword: string | undefined, mode: 'password' | 'link') {
    setLoading(mode)
    setError(null)

    const res = await signIn('invite-token', {
      token,
      email,
      ...(withPassword ? { password: withPassword } : {}),
      redirect: false,
    })

    if (!res || res.error) {
      setError('This invitation could not be accepted. Ask your trainer to send a new link.')
      setLoading(false)
      return
    }

    // Signed in — straight into their account.
    window.location.href = callbackUrl
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Those passwords don’t match.')
      return
    }
    accept(password, 'password')
  }

  return (
    <form onSubmit={handleCreate} className="flex flex-col gap-4">
      {error && <Alert variant="error">{error}</Alert>}

      <Input
        label="Create a password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint="At least 8 characters — you'll use this to sign in to the app."
        disabled={loading !== false}
      />
      <Input
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        disabled={loading !== false}
      />

      <Button
        type="submit"
        loading={loading === 'password'}
        disabled={loading === 'link'}
        size="lg"
        className="w-full"
        style={accentColor ? { backgroundColor: accentColor } : undefined}
      >
        {ctaLabel}
      </Button>

      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200" />
        or
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      {/* Backup: skip the password and rely on magic-link sign-in instead. */}
      <Button
        type="button"
        variant="secondary"
        loading={loading === 'link'}
        disabled={loading === 'password'}
        size="lg"
        className="w-full"
        onClick={() => accept(undefined, 'link')}
      >
        Skip — I’ll use email sign-in links
      </Button>
    </form>
  )
}
