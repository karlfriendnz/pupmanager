import type { Metadata } from 'next'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>
}) {
  const params = await searchParams
  // Compute provider availability server-side so the client never even imports
  // the secret env names. If creds aren't configured, the buttons hide.
  const enabledOAuth = {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    apple: Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY),
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Welcome back
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Sign in to keep your training programmes on track.
        </p>
      </div>
      <LoginForm error={params.error} callbackUrl={params.callbackUrl} enabledOAuth={enabledOAuth} />
    </div>
  )
}
