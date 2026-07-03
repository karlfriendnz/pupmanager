'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Mail, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { SetPasswordStep } from '../set-password-step'
import { safeInternalPath } from '@/lib/safe-redirect'

export function VerifyAccountForm() {
  const params = useSearchParams()
  const initialEmail = params.get('email') ?? ''
  const initialCode = params.get('code') ?? ''
  // When present (the Apple-native flow), the user already has a session, so on
  // success we continue straight there instead of sending them to /login.
  // Guarded against open redirects — only same-origin relative paths survive.
  const next = params.get('next') ? safeInternalPath(params.get('next'), '') : ''
  // relay=1 → the signed-in user is on a private Apple relay address and must
  // swap in a real, deliverable email before we'll send/verify a code.
  const relayParam = params.get('relay') === '1'

  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState(initialCode)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [verified, setVerified] = useState(false)
  // Set for a fresh web lead that still needs a password (not the Apple flow).
  const [setupToken, setSetupToken] = useState<string | null>(null)
  const [resentAt, setResentAt] = useState<number | null>(null)
  const [resending, setResending] = useState(false)
  const codeInputRef = useRef<HTMLInputElement>(null)

  // Relay-email replacement step.
  const [needRealEmail, setNeedRealEmail] = useState(relayParam)
  const [newEmail, setNewEmail] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)

  // One-click verify: when both params arrived in the URL, auto-submit on
  // mount so tapping the email button feels instantaneous. Skipped in relay
  // mode — there's no code yet; we collect a real email first.
  useEffect(() => {
    if (relayParam) return
    if (initialEmail && /^\d{6}$/.test(initialCode)) {
      void verify(initialEmail, initialCode)
    } else {
      codeInputRef.current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submitNewEmail(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSendingEmail(true)
    const res = await fetch('/api/auth/set-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail.trim() }),
    })
    const body = await res.json().catch(() => ({}))
    setSendingEmail(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not update your email. Try again.')
      return
    }
    setEmail(body.email ?? newEmail.trim())
    setNeedRealEmail(false)
    setResentAt(Date.now())
  }

  async function verify(emailArg: string, codeArg: string) {
    setError(null)
    setSubmitting(true)
    const res = await fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailArg, code: codeArg }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not verify the code. Try again.')
      setSubmitting(false)
      return
    }
    const body = await res.json().catch(() => ({}))
    setSubmitting(false)
    // Apple flow (`next` present): a session already exists — no password
    // needed. Go straight on with a full navigation so the server layout
    // re-reads the now-verified state. Short beat to let success paint first.
    if (next) {
      setVerified(true)
      setTimeout(() => { window.location.href = next }, 900)
      return
    }
    // Fresh web lead with no password yet → set one before landing.
    if (body.needsPassword && body.setupToken) {
      setSetupToken(body.setupToken as string)
      return
    }
    setVerified(true)
  }

  async function handleResend() {
    if (!email) {
      setError('Enter the email address you signed up with first.')
      return
    }
    setError(null)
    setResending(true)
    await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    setResentAt(Date.now())
    setResending(false)
  }

  if (setupToken) {
    return <SetPasswordStep email={email} setupToken={setupToken} redirectTo="/dashboard" />
  }

  if (verified) {
    return (
      <Card>
        <CardBody className="pt-8 pb-8 text-center flex flex-col items-center gap-3">
          <div className="h-14 w-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Account verified 🎉</h2>
          <p className="text-sm text-slate-600 max-w-sm">
            {next
              ? 'Your free trial has started — taking you to your dashboard…'
              : 'Your free trial has started. Sign in to set up your first programme.'}
          </p>
          {next ? (
            // Already signed in (Apple flow). Full navigation so the server
            // layout re-reads the now-verified state and lets them through.
            <a
              href={next}
              className="mt-4 inline-flex items-center justify-center w-full max-w-xs rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-3 transition-colors"
            >
              Continue
            </a>
          ) : (
            <Link
              href="/login"
              className="mt-4 inline-flex items-center justify-center w-full max-w-xs rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-3 transition-colors"
            >
              Sign in to PupManager
            </Link>
          )}
        </CardBody>
      </Card>
    )
  }

  // Relay-email step: ask for a real address before showing the code field.
  if (needRealEmail) {
    return (
      <Card>
        <CardBody className="pt-6 flex flex-col gap-4">
          <div className="text-center flex flex-col items-center gap-2">
            <div className="h-14 w-14 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
              <Mail className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900">Confirm your email</h2>
            <p className="text-sm text-slate-500 max-w-sm">
              You signed in with Apple&apos;s “Hide My Email”, so we don&apos;t have an address that can
              receive your verification code or account updates. Enter a real email to continue.
            </p>
          </div>

          {error && <Alert variant="error">{error}</Alert>}

          <form onSubmit={submitNewEmail} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Your email address</label>
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                placeholder="you@yourbusiness.com"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <Button type="submit" size="lg" disabled={sendingEmail || !newEmail.trim()}>
              {sendingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send my code'}
            </Button>
          </form>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardBody className="pt-6 flex flex-col gap-4">
        <div className="text-center flex flex-col items-center gap-2">
          <div className="h-14 w-14 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
            <Mail className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Verify your account</h2>
          <p className="text-sm text-slate-500 max-w-sm">
            Enter the 6-digit code we sent to your inbox to finish signing up.
          </p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <form
          onSubmit={e => { e.preventDefault(); void verify(email, code) }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Email address</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@yourbusiness.com"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Verification code</label>
            <input
              ref={codeInputRef}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              className="w-full text-center text-3xl tracking-[0.5em] font-mono font-bold rounded-xl border border-slate-200 bg-white px-4 py-4 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <Button type="submit" size="lg" disabled={submitting || code.length !== 6 || !email}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify account'}
          </Button>
        </form>

        <div className="text-center text-xs text-slate-500">
          {resentAt
            ? <span className="text-emerald-600">A fresh code is on its way.</span>
            : (
              <>
                Didn&apos;t get it?{' '}
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending}
                  className="text-blue-600 font-medium hover:underline disabled:opacity-60"
                >
                  {resending ? 'Sending…' : 'Resend code'}
                </button>
              </>
            )}
        </div>
      </CardBody>
    </Card>
  )
}
