import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { LogIn, UserPlus } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Welcome' }

/**
 * The first screen someone sees, signed out.
 *
 * `/` used to send everyone straight to the login form, which assumed you
 * already had an account — the wrong assumption now that dog owners are told
 * "we use PupManager, go sign up" and arrive with nothing.
 *
 * Only registration needs to know which kind of person you are; logging in
 * doesn't, because the account already says. So this offers the two actions and
 * lets the create path ask the question, rather than making everyone choose a
 * role before they can reach a password field.
 */
export default async function WelcomePage() {
  // Signed in already? Nothing to welcome — let / route them to their app.
  const session = await auth()
  if (session) redirect('/')

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Welcome to PupManager
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600">
          For dog pros and the owners they work with.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <Link
          href="/login"
          className="flex w-full items-center gap-3 px-4 py-4 text-left active:bg-slate-50"
        >
          <LogIn className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-900">Log in</span>
            <span className="mt-0.5 block text-[13px] text-slate-500">
              You already have an account.
            </span>
          </span>
        </Link>

        <div className="h-px bg-slate-200" aria-hidden />

        <Link
          href="/signup"
          className="flex w-full items-center gap-3 px-4 py-4 text-left active:bg-slate-50"
        >
          <UserPlus className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-900">Create an account</span>
            <span className="mt-0.5 block text-[13px] text-slate-500">
              We&apos;ll ask whether you&apos;re a dog pro or a dog owner.
            </span>
          </span>
        </Link>
      </div>
    </div>
  )
}
