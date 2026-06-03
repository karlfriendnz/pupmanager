'use client'

import { useIsNative } from '@/lib/native'

// Renders its children on web but nothing in the native app. Used to keep
// pricing / subscribe / external-link surfaces out of iOS + Android, where
// Apple Guideline 3.1.1 (no in-app purchase UI, no steering to external
// purchase) applies. Billing is handled entirely on the web.
export function WebOnly({ children }: { children: React.ReactNode }) {
  const native = useIsNative()
  if (native) return null
  return <>{children}</>
}
