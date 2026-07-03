'use client'

import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { signOutWithPush } from '@/lib/sign-out'

// Dedicated sign-out route. Reachable by any role (added to PUBLIC_PATHS in
// proxy.ts so the admin role guard doesn't bounce it to /admin first). Clears
// the NextAuth session cookie — and this device's push token — then lands on
// /login. Useful for fully dropping a stale session (e.g. after a DB reset).
export default function LogoutPage() {
  useEffect(() => {
    signOutWithPush('/login')
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
