'use client'

import { ArrowLeftRight, Loader2 } from 'lucide-react'
import { useState } from 'react'

/**
 * "Switch to my client account" / "Switch to my business".
 *
 * Shown only to people who genuinely hold both — a trainer who is also somebody
 * else's client. That is commoner than it sounds: they train dogs for a living
 * and take their own dog to a specialist. Karen Backhouse owns Guiding Paws and
 * is a client of Mersea Mutts, and before this could reach only the business she
 * owns, because `User.role` decided where she landed and nothing offered a way
 * across.
 *
 * The API re-checks access and the layouts re-derive it from the database on
 * every request, so this button cannot grant anything — at worst it sets a
 * cookie for a side the server then declines to render.
 */
export function ProfileSwitchButton({
  to,
  variant = 'sidebar',
  className = '',
}: {
  /** The side to switch TO. */
  to: 'trainer' | 'client'
  /** `sidebar` matches the sign-out row; `sheet` matches the mobile More list. */
  variant?: 'sidebar' | 'sheet'
  className?: string
}) {
  const [busy, setBusy] = useState(false)

  const label = to === 'client' ? 'Switch to my client account' : 'Switch to my business'

  async function go() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/profile/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side: to }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setBusy(false)
        return
      }
      // A full navigation, not a router push: the surfaces are different route
      // groups with different layouts, and the cookie has to be read by the
      // server on the way in.
      window.location.href = body?.redirectTo ?? (to === 'trainer' ? '/dashboard' : '/home')
    } catch {
      setBusy(false)
    }
  }

  const Icon = busy ? Loader2 : ArrowLeftRight

  if (variant === 'sheet') {
    return (
      <button onClick={go} disabled={busy} className={`w-full flex items-center gap-4 px-3 py-3.5 text-left ${className}`}>
        <span className="flex h-9 w-9 items-center justify-center shrink-0">
          <Icon className={`h-5 w-5 ${busy ? 'animate-spin' : ''}`} />
        </span>
        <span className="text-[15px] font-medium flex-1">{label}</span>
      </button>
    )
  }

  return (
    <button
      onClick={go}
      disabled={busy}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-60 ${className}`}
    >
      <Icon className={`h-5 w-5 ${busy ? 'animate-spin' : ''}`} />
      {label}
    </button>
  )
}
