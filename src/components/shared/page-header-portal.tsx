'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

type BackLink = { href?: string; label?: string; onClick?: () => void }

// On desktop the global top bar (TrainerShell) owns the page title; this portals
// a page's back arrow + actions INTO that bar so there's no redundant second
// header row. The slots (#pm-topbar-back / #pm-topbar-actions) live in the bar
// and auto-collapse (empty:hidden) when a page has none. Mobile has no top bar,
// so PageHeader renders these in place instead.
export function PageHeaderTopBarPortal({ back, actions }: { back?: BackLink; actions?: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  if (!ready) return null

  const backSlot = document.getElementById('pm-topbar-back')
  const actionsSlot = document.getElementById('pm-topbar-actions')

  const backEl = back && (
    back.onClick ? (
      <button
        type="button"
        onClick={back.onClick}
        aria-label={back.label ?? 'Back'}
        className="-ml-1 grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
    ) : (
      <Link
        href={back.href ?? '#'}
        aria-label={back.label ?? 'Back'}
        className="-ml-1 grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>
    )
  )

  return (
    <>
      {backEl && backSlot && createPortal(backEl, backSlot)}
      {actions && actionsSlot && createPortal(actions, actionsSlot)}
    </>
  )
}
