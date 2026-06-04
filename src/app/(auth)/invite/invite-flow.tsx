'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { isNative } from '@/lib/native'
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-links'

export function InviteFlow({
  token,
  email,
  accentColor = null,
  ctaLabel = 'Accept invitation',
  isClient,
  callbackUrl = '/home',
  greetName = null,
  dogList = null,
}: {
  token: string
  email: string
  accentColor?: string | null
  ctaLabel?: string
  /** Client invites end on the "get the app" screen; team/trainer invites go
   *  straight to the dashboard. */
  isClient: boolean
  callbackUrl?: string
  greetName?: string | null
  dogList?: string | null
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleAccept() {
    setLoading(true)
    setError(null)

    // Validate + consume the invite token AND establish the session in one
    // step — no second magic-link email.
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

    // Trainers (team invites) and anyone already inside the native app skip the
    // install prompt and go straight to their destination.
    if (!isClient || isNative()) {
      window.location.href = isClient ? '/home' : callbackUrl
      return
    }

    // Client on the web — they're now signed in. Show a success screen with a
    // clear primary path into their account + the app as a secondary nudge.
    setDone(true)
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="text-3xl" aria-hidden>🎉</div>
        <div>
          <p className="text-base font-semibold text-slate-900">
            {greetName ? `You're all set, ${greetName}!` : "You're all set!"}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            You&apos;re signed in already — no password to remember. Jump straight into
            {dogList ? ` ${dogList}'s` : ' your'} training space.
          </p>
        </div>

        {/* Primary: the obvious next step — they're already authenticated, so
            this drops them straight into their account. */}
        <Button
          onClick={() => { window.location.href = '/home' }}
          size="lg"
          className="w-full"
          style={accentColor ? { backgroundColor: accentColor } : undefined}
        >
          Go to my training space
        </Button>

        {/* Secondary: install the native app (clearly the alternative, not the
            thing blocking them from getting in). */}
        <div className="w-full border-t border-slate-100 pt-4">
          <p className="mb-3 text-xs font-medium text-slate-400">
            {dogList ? `Or get the app to follow ${dogList} on the go` : 'Or get the app for the full experience'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label="Download on the App Store">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/app-store-badge.png" alt="Download on the App Store" className="h-11 w-auto" />
            </a>
            <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label="Get it on Google Play">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/google-play-badge.png" alt="Get it on Google Play" className="h-11 w-auto" />
            </a>
          </div>
        </div>
      </div>
    )
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
      <p className="text-center text-xs text-slate-400">Takes about 30 seconds.</p>
    </div>
  )
}
