'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// Lets any page push its title into the desktop top bar. The shared PageHeader
// component sets this automatically, so existing pages need no changes; pages
// without a PageHeader can render <SetPageTitle title="…" /> directly.
type PageTitleCtx = {
  title: string | null
  setTitle: (t: string | null) => void
  /** Whether the current page portals a back arrow into the top bar. */
  hasBack: boolean
  setHasBack: (b: boolean) => void
}

const Ctx = createContext<PageTitleCtx | null>(null)

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null)
  const [hasBack, setHasBack] = useState(false)
  return <Ctx.Provider value={{ title, setTitle, hasBack, setHasBack }}>{children}</Ctx.Provider>
}

export function usePageTitle(): string | null {
  return useContext(Ctx)?.title ?? null
}

/**
 * True while the page shows a back arrow in the top bar.
 *
 * The phone bar uses it to drop the menu icon: from inside a class or a client
 * you reach for "back", and two navigation controls side by side is one too
 * many. It can't just look at the slot — that's filled by a portal.
 */
export function usePageHasBack(): boolean {
  return useContext(Ctx)?.hasBack ?? false
}

/** Set by PageHeader for the length of a page that has a back arrow. */
export function SetPageHasBack({ value }: { value: boolean }) {
  const setHasBack = useContext(Ctx)?.setHasBack
  useEffect(() => {
    setHasBack?.(value)
    return () => setHasBack?.(false)
  }, [value, setHasBack])
  return null
}

// True when rendered inside a PageTitleProvider (i.e. the trainer shell, whose
// mobile top bar shows the page title itself). PageHeader uses this to skip its
// own mobile in-page bar there and avoid a duplicate header row.
export function useHasPageTitleShell(): boolean {
  return useContext(Ctx) != null
}

// Whether to show the one-line "what this page is" helper text under each page
// title. Seeded per-user (User.showPageHelp) by the trainer layout; consumed by
// PageHeader. Defaults to true if no provider is present.
const HelpCtx = createContext<boolean>(true)

export function PageHelpProvider({ show, children }: { show: boolean; children: ReactNode }) {
  return <HelpCtx.Provider value={show}>{children}</HelpCtx.Provider>
}

export function usePageHelp(): boolean {
  return useContext(HelpCtx)
}

// Drop into any page to set the top-bar title. `title` is a string so the
// effect dependency is stable — no render loop. Clears on unmount.
export function SetPageTitle({ title }: { title: string }) {
  const setTitle = useContext(Ctx)?.setTitle
  useEffect(() => {
    setTitle?.(title)
    return () => setTitle?.(null)
  }, [title, setTitle])
  return null
}
