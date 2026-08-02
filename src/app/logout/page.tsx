'use client'

import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { signOutWithPush } from '@/lib/sign-out'

// Dedicated sign-out route. Reachable by any role (added to PUBLIC_PATHS in
// proxy.ts so the admin role guard doesn't bounce it to /admin first). Clears
// the NextAuth session cookie — and this device's push token — then lands on
// /login. Useful for fully dropping a stale session (e.g. after a DB reset).
//
// `?callbackUrl=` sends them somewhere other than /login afterwards. The public
// sign-up run needs it: someone who opens a friend's continuation link while
// signed in as themselves has to sign out and come BACK to that link, and a
// sign-out that always lands on /login drops the thread on the floor.
//
// Same-origin PATHS only. An absolute URL here would make this an open redirect
// on a route that is public by design, so anything that isn't a bare "/path" is
// ignored rather than sanitised — there is no legitimate caller it can break.
export default function LogoutPage() {
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('callbackUrl')
    const safe = raw && /^\/(?!\/)/.test(raw) ? raw : '/login'
    signOutWithPush(safe)
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Signing you out…</p>
      </div>
    </main>
  )
}
