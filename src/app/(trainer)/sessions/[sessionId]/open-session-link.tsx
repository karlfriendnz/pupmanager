'use client'

import Link from 'next/link'

// Small client wrapper so the onClick stopPropagation can ride across the
// server/client boundary — server components can't pass event handlers to
// child components, even Next.js Links.
export function OpenSessionLink({ sessionId }: { sessionId: string }) {
  return (
    <Link
      href={`/sessions/${sessionId}`}
      onClick={e => e.stopPropagation()}
      className="shrink-0 text-[13px] font-medium text-slate-500 hover:text-slate-900"
    >
      Open
    </Link>
  )
}
