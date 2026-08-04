import Link from 'next/link'
import { Compass } from 'lucide-react'

/**
 * The page for a URL that isn't a page.
 *
 * There was none. Next's bare default renders with no shell at all — no menu,
 * no header, nothing — which on the web is merely ugly and inside the Capacitor
 * app is a dead end: the native shell has no address bar and no back button, so
 * a dog owner who mistypes or follows a stale link is simply stuck there.
 *
 * So the one thing this page must do is offer a way out that works without
 * browser chrome. `/` is that way: it redirects to whichever home belongs to
 * whoever is signed in — trainer, client, admin, or the login screen — so this
 * file needs to know nothing about who they are.
 *
 * House style, deliberately: one bordered block, hairline divider, a plain line
 * icon. An apologetic illustration would make a small wrong turn feel like a
 * catastrophe.
 */
export default function NotFound() {
  return (
    // Tagged so a test can assert "this is the not-found page" without pinning
    // the wording — the copy says "That page isn't here" and deliberately never
    // says "404", which is what a spec matching /404|not found/ was relying on.
    <main data-testid="not-found" className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white">
        <div className="px-5 py-6 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-slate-50 text-slate-700">
            <Compass className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </span>
          <h1 className="mt-3 text-base font-semibold text-slate-900">
            That page isn&rsquo;t here
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            The link may be old, or the thing it pointed at may have been deleted.
          </p>
        </div>
        <div className="border-t border-slate-100 p-3">
          <Link
            href="/"
            className="flex h-11 w-full items-center justify-center rounded-xl bg-[var(--pm-brand-600)] text-sm font-semibold text-white transition-colors hover:bg-[var(--pm-brand-700)]"
          >
            Take me back
          </Link>
        </div>
      </div>
    </main>
  )
}
