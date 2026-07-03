'use client'

import { useState, useRef, useEffect } from 'react'
import { signIn } from 'next-auth/react'
import { KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'

// Final step of the split signup: the trainer has verified their OTP and now
// chooses a password. On success we sign them straight in and hand off to the
// dashboard, where the onboarding wizard collects the rest of their business
// profile. `setupToken` was issued by /api/auth/verify-email.
export function SetPasswordStep({
  email,
  setupToken,
  redirectTo = '/dashboard',
}: {
  email: string
  setupToken: string
  redirectTo?: string
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    const res = await fetch('/api/auth/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token: setupToken, password }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not set your password. Try again.')
      setSubmitting(false)
      return
    }

    // Sign them in with the credentials they just set, then hand off. A full
    // navigation so the server layout re-reads the fresh session.
    const result = await signIn('credentials', { email, password, redirect: false })
    if (result?.error) {
      // Password saved but auto sign-in hiccuped — send them to login.
      window.location.href = '/login'
      return
    }
    window.location.href = redirectTo
  }

  return (
    <Card>
      <CardBody className="pt-6 flex flex-col gap-4">
        <div className="text-center flex flex-col items-center gap-2">
          <div className="h-14 w-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <KeyRound className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Set your password</h2>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Hidden username field helps password managers associate the login. */}
          <input type="email" name="email" value={email} autoComplete="username" readOnly hidden />
          <Input
            ref={inputRef}
            label="Password"
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <Input
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
          />
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Finish & go to dashboard'}
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
