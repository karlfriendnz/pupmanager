import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { RegisterForm } from './register-form'

export const metadata: Metadata = { title: 'Create account' }

export default async function RegisterPage() {
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
