import Link from 'next/link'
import { Check, X } from 'lucide-react'

// Where Stripe returns a GUEST buyer after an instant sale. Public and
// login-free by design: a guest has no account, and the whole point of the flow
// is that they never needed one. Deliberately thin — it knows nothing about the
// sale (no token to look one up with), so it only reflects what Stripe tells us
// in the query string. The real record of the payment is the Payment row the
// Connect webhook settles.
export const metadata = { title: 'Thanks | PupManager' }

export default async function GuestSaleThanksPage({
  searchParams,
}: {
  searchParams: Promise<{ paid?: string; cancelled?: string }>
}) {
  const { cancelled } = await searchParams
  const isCancelled = cancelled === '1'

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-sm">
        <div
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${
            isCancelled ? 'bg-slate-100 text-slate-400' : 'bg-green-100 text-green-700'
          }`}
        >
          {isCancelled ? <X className="h-7 w-7" /> : <Check className="h-7 w-7" />}
        </div>

        <h1 className="mt-5 text-xl font-semibold text-slate-900">
          {isCancelled ? 'Payment cancelled' : 'Payment received'}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {isCancelled
            ? 'Nothing was charged. Ask to try again if that wasn’t deliberate.'
            : 'Thanks! Your receipt is on its way by email.'}
        </p>

        <p className="mt-8 text-xs text-slate-400">
          Powered by{' '}
          <Link href="https://pupmanager.com" className="font-medium text-[var(--pm-brand-600)] hover:underline">
            PupManager
          </Link>
        </p>
      </div>
    </main>
  )
}
