import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { ClientSignupForm } from './client-signup-form'

export const metadata: Metadata = {
  title: 'Sign up as a dog owner · PupManager',
  description: 'Create your PupManager account and connect with your dog trainer.',
}

// Dog-owner signup, reached from the role chooser on /signup and /register.
// Sits under /signup/* on purpose: proxy.ts treats that prefix as public, so
// this needs no middleware change.
export default async function ClientSignupPage() {
  const session = await auth()
  if (session?.user?.role === 'TRAINER') redirect('/dashboard')
  if (session?.user?.role === 'CLIENT') redirect('/home')

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Set up your dog&apos;s account
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600">
          See your sessions, notes and messages from your trainer in one place.
        </p>
      </div>

      <ClientSignupForm />

      <p className="text-center text-sm text-slate-500">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-blue-600 hover:underline">
          Sign in
        </Link>
      </p>
      <p className="text-center text-sm text-slate-500">
        Actually a dog pro?{' '}
        <Link href="/signup?as=pro" className="font-medium text-blue-600 hover:underline">
          Start a trial
        </Link>
      </p>
    </div>
  )
}
