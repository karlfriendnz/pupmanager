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
type Slots = {
  back: HTMLElement | null
  actions: HTMLElement | null
  backMobile: HTMLElement | null
  actionsMobile: HTMLElement | null
}

const NO_SLOTS: Slots = { back: null, actions: null, backMobile: null, actionsMobile: null }

export function PageHeaderTopBarPortal({ back, actions }: { back?: BackLink; actions?: ReactNode }) {
  // The slots are found in an EFFECT and kept in state, and the lookup re-runs
  // whenever the DOM changes. It used to be a bare getElementById during
  // render, which reads the bar exactly once and never again — and the bar is
  // not always there at that moment.
  //
  // How that showed up: open a message thread (immersive, no top bar, so the
  // bar is unmounted), tap "View profile". The profile mounts, this looks for
  // the slot, finds nothing because the bar is still gone, and the profile's
  // own `keepTopBar` brings the bar back a tick LATER. Nothing re-rendered
  // this, so the back arrow never appeared — on a screen that also hides the
  // bottom tabs, i.e. a dead end with no way out. Karl found it; it would have
  // hit any immersive page reached from another immersive page.
  const [slots, setSlots] = useState<Slots>(NO_SLOTS)

  useEffect(() => {
    let queued = 0
    const read = () => {
      const next: Slots = {
        back: document.getElementById('pm-topbar-back'),
        actions: document.getElementById('pm-topbar-actions'),
        backMobile: document.getElementById('pm-topbar-back-mobile'),
        actionsMobile: document.getElementById('pm-topbar-actions-mobile'),
      }
      setSlots(prev =>
        prev.back === next.back &&
        prev.actions === next.actions &&
        prev.backMobile === next.backMobile &&
        prev.actionsMobile === next.actionsMobile
          ? prev
          : next,
      )
    }
    // Coalesced to a frame — this watches the whole body, and portalling into a
    // slot is itself a mutation.
    const schedule = () => {
      if (queued) return
      queued = requestAnimationFrame(() => {
        queued = 0
        read()
      })
    }
    read()
    const mo = new MutationObserver(schedule)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      if (queued) cancelAnimationFrame(queued)
    }
  }, [])

  const { back: backSlot, actions: actionsSlot, backMobile: backSlotMobile, actionsMobile: actionsSlotMobile } = slots

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
