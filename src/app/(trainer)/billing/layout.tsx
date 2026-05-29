'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useIsNative } from '@/lib/native'

// On the native iOS/Android app we never surface billing at all (App Store
// Guideline 3.1.1). Trainers manage their subscription on the web; the app is
// just a tool for existing accounts. Any native user who lands on a /billing
// route (e.g. the post-signup redirect to /billing/setup) is bounced straight
// to the dashboard, so there's no subscription surface for review to flag.
export default function BillingLayout({ children }: { children: React.ReactNode }) {
  const native = useIsNative()
  const router = useRouter()

  useEffect(() => {
    if (native) router.replace('/dashboard')
  }, [native, router])

  // useIsNative is false during SSR + the first client render (so this matches
  // the server markup), then flips true on native after mount → we render
  // nothing and the effect above redirects.
  if (native) return null
  return <>{children}</>
}
