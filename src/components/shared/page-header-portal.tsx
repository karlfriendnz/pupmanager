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
  // Mobile counterparts — the trainer phone top bar shows the page title, so it
  // hosts the back arrow + actions there too (see app-shell mobile header).
  const backSlotMobile = document.getElementById('pm-topbar-back-mobile')
  const actionsSlotMobile = document.getElementById('pm-topbar-actions-mobile')

  // A fresh back element per slot — the same React node can't be portalled twice.
  const backEl = (cls: string) =>
    back && (
      back.onClick ? (
        <button
          type="button"
          onClick={back.onClick}
          aria-label={back.label ?? 'Back'}
          className={cls}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      ) : (
        <Link href={back.href ?? '#'} aria-label={back.label ?? 'Back'} className={cls}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
      )
    )

  const deskCls = '-ml-1 grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors'
  // 44px on the phone, matching the Menu button it stands in for. On an
  // immersive page (a form) it is the ONLY way out — the menu and the bottom
  // tabs have both stood down — so it gets a real thumb-sized target rather
  // than the 36px it was.
  const mobCls = '-ml-1.5 grid h-11 w-11 place-items-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors'

  return (
    <>
      {back && backSlot && createPortal(backEl(deskCls), backSlot)}
      {actions && actionsSlot && createPortal(actions, actionsSlot)}
      {back && backSlotMobile && createPortal(backEl(mobCls), backSlotMobile)}
      {actions && actionsSlotMobile && createPortal(actions, actionsSlotMobile)}
    </>
  )
}
