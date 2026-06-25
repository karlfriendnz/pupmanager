'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// Lets any page push its title into the desktop top bar. The shared PageHeader
// component sets this automatically, so existing pages need no changes; pages
// without a PageHeader can render <SetPageTitle title="…" /> directly.
type PageTitleCtx = { title: string | null; setTitle: (t: string | null) => void }

const Ctx = createContext<PageTitleCtx | null>(null)

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null)
  return <Ctx.Provider value={{ title, setTitle }}>{children}</Ctx.Provider>
}

export function usePageTitle(): string | null {
  return useContext(Ctx)?.title ?? null
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
