'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PUBLIC_FORM_CARD, PUBLIC_FORM_INPUT } from '@/components/shared/public-form-shell'

/**
 * The password step's controls.
 *
 * What it asks for depends on who is already here, and the three cases are all
 * on this screen rather than three routes — the run is supposed to feel like
 * one thing, and bouncing somebody to a different URL to be told "you already
 * have an account" is the break we are removing, in miniature.
 *
 *   nobody signed in, no account yet  → choose a password
 *   nobody signed in, account exists  → sign in; the run waits, unspent
 *   signed in as them                 → one tap, no password
 *   signed in as somebody else        → stop, and say whose account this is
 *
 * On success the browser signs itself in with the address it never had to type
 * and goes to `/`, where the client layout's EXISTING intake gate takes over.
 * There is no second gate: the run sets ClientProfile.intakeFormId and the app
 * already knows what to do with that.
 */
export function ContinuationAccountStep({
  formId,
  token,
  email,
  businessName,
  signedInAs,
}: {
  formId: string
  token: string
  email: string
  businessName: string
  signedInAs: string | null
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when the address already has an account. Not an error — it is a real,
  // ordinary outcome for a dog owner their trainer added last year.
  const [needsSignIn, setNeedsSignIn] = useState(false)

  const sameAccount = !!signedInAs && signedInAs === email.trim().toLowerCase()
  const otherAccount = !!signedInAs && !sameAccount
  // Round-trip back here after signing in, so the run resumes on the far side
  // instead of dumping them on a home screen with the thread lost.
  const resumeUrl = `/form/${encodeURIComponent(formId)}/account?t=${encodeURIComponent(token)}`
  const signInHref = `/login?callbackUrl=${encodeURIComponent(resumeUrl)}`

  async function submit() {
    setError(null)
    if (!sameAccount) {
      if (password.length < 8) return setError('Use at least 8 characters.')
      if (password !== confirm) return setError('Those two passwords do not match.')
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/form/${encodeURIComponent(formId)}/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No email field, on purpose: the server reads it off the enquiry this
        // token resolves to. See the route's header.
        body: JSON.stringify(sameAccount ? { token } : { token, password }),
      })
      const body = await res.json().catch(() => ({}))

      if (body?.status === 'signin') {
        setNeedsSignIn(true)
        setBusy(false)
        return
      }
      if (!res.ok || body?.status !== 'ready') {
        setError(typeof body?.error === 'string' ? body.error : 'Could not finish setting up — please try again.')
        setBusy(false)
        return
      }

      // Already holding a session (the resume case) — nothing to sign into.
      if (!sameAccount) {
        const signedIn = await signIn('credentials', {
          email: body.email,
          password,
          redirect: false,
        })
        if (signedIn?.error) {
          // The account IS made; only the automatic sign-in failed. Say that,
          // rather than implying the last two minutes were wasted.
          setError('Your account is set up, but we could not sign you in automatically. Please sign in.')
          setBusy(false)
          return
        }
      }

      // A full navigation, not router.push: the session cookie and the active-
      // trainer cookie were both set on responses this render never saw, and a
      // client-side transition would render the old ones.
      window.location.href = '/'
    } catch {
      setError('Could not finish setting up — please try again.')
      setBusy(false)
    }
  }

  if (otherAccount) {
    return (
      <div className={PUBLIC_FORM_CARD} data-review-scope="Continuous sign-up: signed in as somebody else">
        <p className="text-sm leading-relaxed text-slate-500">
          You&apos;re signed in as <span className="font-medium text-slate-900">{signedInAs}</span>,
          but this sign-up is for <span className="font-medium text-slate-900">{email}</span>.
        </p>
        <p className="text-sm leading-relaxed text-slate-500">
          Sign out and open the link again, and we&apos;ll carry on.
        </p>
        <a
          href={`/logout?callbackUrl=${encodeURIComponent(resumeUrl)}`}
          className="flex h-12 items-center justify-center rounded-xl bg-[var(--accent,#2563eb)] text-sm font-semibold text-white"
        >
          Sign out and continue
        </a>
      </div>
    )
  }

  if (needsSignIn) {
    return (
      <div className={PUBLIC_FORM_CARD} data-review-scope="Continuous sign-up: account already exists">
        <p className="text-sm leading-relaxed text-slate-500">
          You already have a PupManager account for{' '}
          <span className="font-medium text-slate-900">{email}</span>. Sign in and we&apos;ll add you
          to {businessName} and pick straight up where you left off.
        </p>
        <a
          href={signInHref}
          className="flex h-12 items-center justify-center rounded-xl bg-[var(--accent,#2563eb)] text-sm font-semibold text-white"
        >
          Sign in to continue
        </a>
        <p className="text-xs leading-relaxed text-slate-400">
          Never set a password? Use &ldquo;Email me a sign-in link&rdquo; on the sign-in screen.
        </p>
      </div>
    )
  }

  return (
    <div className={PUBLIC_FORM_CARD} data-review-scope="Continuous sign-up: choose a password">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">Your email</label>
        {/* Shown, not editable. It is the address they gave a moment ago, and
            an editable box here would be a field pointing at other people's
            accounts on a public, account-creating page. */}
        <div className="flex h-12 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
          <Mail className="h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
          <span className="truncate">{email}</span>
        </div>
        <p className="mt-1.5 text-xs text-slate-400">
          The address you just gave {businessName}. This is how you&apos;ll sign in.
        </p>
      </div>

      {sameAccount ? (
        <p className="text-sm leading-relaxed text-slate-500">
          You&apos;re already signed in, so there&apos;s no password to set. Carry on and we&apos;ll
          add you to {businessName}.
        </p>
      ) : (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="pm-continue-password">
              Choose a password<span className="ml-1 text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                id="pm-continue-password"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(null) }}
                autoComplete="new-password"
                aria-label="Choose a password"
                className={`${PUBLIC_FORM_INPUT} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShow(v => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400"
              >
                {show
                  ? <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                  : <Eye className="h-4 w-4" strokeWidth={1.75} />}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-400">At least 8 characters.</p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="pm-continue-confirm">
              Confirm password<span className="ml-1 text-red-500">*</span>
            </label>
            <input
              id="pm-continue-confirm"
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setError(null) }}
              autoComplete="new-password"
              aria-label="Confirm password"
              className={PUBLIC_FORM_INPUT}
            />
          </div>
        </>
      )}

      {error && (
        <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
      )}

      <Button size="lg" className="w-full" onClick={submit} loading={busy}>
        <Lock className="h-4 w-4" strokeWidth={1.75} />
        {sameAccount ? 'Continue' : 'Create my account'}
      </Button>
    </div>
  )
}
