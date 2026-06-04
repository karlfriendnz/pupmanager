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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Those passwords don’t match.')
      return
    }

    setLoading(true)
    setError(null)

    // Accept the invite (validate + consume the one-time token), store the
    // password, and establish the session in one step. The same email +
    // password then signs them in anywhere, including the native app.
    const res = await signIn('invite-token', {
      token,
      email,
      password,
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
        disabled={loading}
      />
      <Input
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        disabled={loading}
      />

      <Button
        type="submit"
        loading={loading}
        size="lg"
        className="w-full"
        style={accentColor ? { backgroundColor: accentColor } : undefined}
      >
        {ctaLabel}
      </Button>
    </form>
  )
}
