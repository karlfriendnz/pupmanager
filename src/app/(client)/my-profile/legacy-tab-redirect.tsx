'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// The Dogs and Notifications tabs left this page. `?tab=` is handled on the
// server, but a fragment (`/my-profile#notifications`) never reaches it — the
// browser keeps the hash to itself — so an old link would silently land on the
// details form with nothing to explain why. This forwards it.
const MOVED: Record<string, string> = {
  '#dogs': '/my-dogs',
  '#notifications': '/my-notifications?tab=settings',
}

export function LegacyTabRedirect() {
  const router = useRouter()
  useEffect(() => {
    const dest = MOVED[window.location.hash]
    if (dest) router.replace(dest)
  }, [router])
  return null
}
