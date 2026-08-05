import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Thanks for trying PupManager',
  robots: { index: false, follow: false },
}

/**
 * Where a visitor lands after pressing "Finish demo".
 *
 * Says plainly that the workspace is gone — a stranger who typed anything into
 * it should not have to wonder — and offers the two next steps that are
 * actually available today: start a real trial, or read about it.
 *
 * OPEN QUESTION FOR KARL: whether a demo should be able to CONVERT into a real
 * trial in place (keeping the data they made). Nothing here does that; the
 * "Start a free trial" link is the ordinary sign-up. Converting means the lead
 * becomes a customer record and the sandbox stops being purgeable, which is a
 * different feature with different rules.
 */
export default function TryFinishedPage() {
  return (
    <div data-review-scope="Demo finished" className="flex flex-col gap-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Thanks for having a look</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your demo workspace and everything in it has been deleted.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
        <Link href="/register" className="block px-4 py-4 text-left">
          <span className="block text-sm font-medium text-slate-900">Start a free trial</span>
          <span className="mt-0.5 block text-xs text-slate-500">Your own account, with your own clients. No card needed.</span>
        </Link>
        <Link href="/try" className="block px-4 py-4 text-left">
          <span className="block text-sm font-medium text-slate-900">Have another go</span>
          <span className="mt-0.5 block text-xs text-slate-500">A fresh demo, from the top.</span>
        </Link>
      </div>

      <p className="text-xs text-slate-500">
        Questions? Email <a className="underline underline-offset-2" href="mailto:hello@pupmanager.com">hello@pupmanager.com</a>.
      </p>
    </div>
  )
}
