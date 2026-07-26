'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { SetPageHasBack } from '@/components/shared/page-title'

// Inside a settings sub-page on a phone, the top bar shows a back arrow to the
// settings menu instead of the app menu — the same convention every other
// detail screen in the app uses (PageHeader `back` → usePageHasBack, which is
// what makes the phone bar drop its hamburger).
//
// Why not simply pass `back` to the PageHeader in page.tsx: PageHeader portals
// the arrow into the DESKTOP bar too, and on desktop Settings never leaves its
// rail — a tab is always showing, so "back" there would just silently reset you
// to the first tab. So this portals into the phone slot only, and leans on
// SetPageHasBack (read only by the phone header) for the menu swap.
export function SettingsBackLink() {
  // The portal target only exists in the browser, so wait for mount before
  // reaching for it (same one-time mount flag as PageHeaderTopBarPortal).
  const [ready, setReady] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true)
  }, [])
  const slot = ready ? document.getElementById('pm-topbar-back-mobile') : null

  return (
    <>
      <SetPageHasBack value />
      {slot &&
        createPortal(
          <Link
            href="/settings"
            aria-label="All settings"
            className="-ml-1.5 grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>,
          slot,
        )}
    </>
  )
}
