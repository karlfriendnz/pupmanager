'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { RotateCw } from 'lucide-react'

/**
 * The page for when something threw.
 *
 * Same reasoning as not-found.tsx: without this, a runtime error renders Next's
 * bare default with no shell, and inside the Capacitor app — no address bar, no
 * back button — that is a dead end rather than an inconvenience.
 *
 * TRY AGAIN COMES FIRST, and that ordering is the point. Most of what lands
 * here is transient: a dropped connection, a request that raced a navigation, a
 * cold function. `reset()` re-renders the segment without a full page load, so
 * the common case costs one tap and no lost context. Leaving is the fallback.
 *
 * The message says nothing about WHAT broke, on purpose. A stack trace helps
 * nobody holding a lead in one hand, and error text is a place apps leak
 * internals — table names, ids, query fragments. The digest is logged for us;
 * the person gets a sentence they can act on.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Reaches Vercel's function logs, where a real diagnosis can start. The
    // digest is what ties this render to the server-side stack.
    console.error('[app error]', error.digest ?? '(no digest)', error)
  }, [error])

  return (
    <main className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white">
        <div className="px-5 py-6 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-slate-50 text-slate-700">
            <RotateCw className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </span>
          <h1 className="mt-3 text-base font-semibold text-slate-900">
            That didn&rsquo;t load
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Something went wrong at our end. Trying again usually sorts it.
          </p>
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-100 p-3">
          <button
            type="button"
            onClick={reset}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--pm-brand-600)] text-sm font-semibold text-white transition-colors hover:bg-[var(--pm-brand-700)]"
          >
            <RotateCw className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            Try again
          </button>
          <Link
            href="/"
            className="flex h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Back to the app
          </Link>
        </div>
      </div>
    </main>
  )
}
