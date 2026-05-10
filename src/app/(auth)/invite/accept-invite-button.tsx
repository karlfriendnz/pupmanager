'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'

export function AcceptInviteButton({ token, email }: { token: string; email: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAccept() {
    setLoading(true)
    setError(null)

    const res = await fetch('/api/auth/accept-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Something went wrong. Please try again.')
      setLoading(false)
      return
    }

    // Token verified — send a magic link so the client can sign in
    await signIn('resend', { email, callbackUrl: '/home', redirect: false })

    // Redirect to verify-email page, passing the email so the page
    // can resolve the trainer and brand the "check your inbox"
    // screen with their logo.
    window.location.href = `/verify-email?email=${encodeURIComponent(email)}`
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert variant="error">{error}</Alert>}
      <Button onClick={handleAccept} loading={loading} size="lg" className="w-full">
        Accept invitation
      </Button>
    </div>
  )
}
