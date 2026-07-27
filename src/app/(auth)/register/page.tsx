import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { RoleChooser } from '../role-chooser'
import { RegisterForm } from './register-form'

export const metadata: Metadata = { title: 'Create account' }

// /register is the IN-APP "Create account" link (from /login and the native
// shells); /signup is the marketing entry from pupmanager.com/pricing. They
// post to different endpoints — /register captures a lead with no password and
// sets one after the OTP, /signup takes a password up front — so they stay
// separate forms. What they now share is step 0: the role chooser. Whichever
// door a dog owner walks through, they end up at the dog-owner form instead of
// silently becoming a trainer on a trial.
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>
}) {
  const { as } = await searchParams
  if (as !== 'pro') {
    return <RoleChooser proHref="/register?as=pro" />
  }

  // Vercel's edge tells us where the request came from. Used ONLY to preselect
  // the country — the trainer confirms it, so a VPN or a missing header just
  // means they pick from the list.
  const geoCountry = (await headers()).get('x-vercel-ip-country')?.toUpperCase() || null
  const enabledOAuth = {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    apple: Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY),
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
        <p className="mt-1 text-sm text-slate-500">
          Start managing your clients and training plans
        </p>
      </div>
      <RegisterForm enabledOAuth={enabledOAuth} defaultCountry={geoCountry} />
    </div>
  )
}
