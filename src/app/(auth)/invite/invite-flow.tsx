'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'

export function InviteFlow({
  token,
  email,
  accentColor = null,
  ctaLabel = 'Accept invitation',
  callbackUrl = '/home',
}: {
  token: string
  email: string
  accentColor?: string | null
  ctaLabel?: string
  /** Where to land after sign-in — /home for clients, /dashboard for team. */
  callbackUrl?: string
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAccept() {
    setLoading(true)
    setError(null)

    // Validate + consume the one-time invite token AND establish the session in
    // one step — no second magic-link email, no login screen.
    const res = await signIn('invite-token', {
      token,
      email,
      redirect: false,
    })

    if (!res || res.error) {
      setError('This invitation could not be accepted. Ask your trainer to send a new link.')
      setLoading(false)
      return
    }

    // Signed in automatically — drop them straight into their account.
    window.location.href = callbackUrl
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert variant="error">{error}</Alert>}
      <Button
        onClick={handleAccept}
        loading={loading}
        size="lg"
        className="w-full"
        style={accentColor ? { backgroundColor: accentColor } : undefined}
      >
        {ctaLabel}
      </Button>
      <p className="text-center text-xs text-slate-400">
        No password needed — this takes you straight in.
      </p>
    </div>
  )
}
