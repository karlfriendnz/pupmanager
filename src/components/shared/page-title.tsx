'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

// Lets any page push its title into the desktop top bar. The shared PageHeader
// component sets this automatically, so existing pages need no changes; pages
// without a PageHeader can render <SetPageTitle title="…" /> directly.
type PageTitleCtx = {
  title: string | null
  setTitle: (t: string | null) => void
  /** Whether the current page portals a back arrow into the top bar. */
  hasBack: boolean
  setHasBack: (b: boolean) => void
  /** Whether the page has taken over the phone screen (see SetPageImmersive). */
  immersive: boolean
  /** Whether that immersive page still wants the shell's phone top bar. */
  immersiveKeepsTopBar: boolean
  setImmersive: (b: boolean, keepTopBar: boolean) => void
}

const Ctx = createContext<PageTitleCtx | null>(null)

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null)
  const [hasBack, setHasBack] = useState(false)
  const [immersive, setImmersiveOn] = useState(false)
  const [immersiveKeepsTopBar, setKeepsTopBar] = useState(false)
  const setImmersive = useCallback((b: boolean, keepTopBar: boolean) => {
    setImmersiveOn(b)
    setKeepsTopBar(b && keepTopBar)
  }, [])
  return (
    <Ctx.Provider value={{ title, setTitle, hasBack, setHasBack, immersive, immersiveKeepsTopBar, setImmersive }}>
      {children}
    </Ctx.Provider>
  )
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

/**
 * True while a page has taken over the phone screen and the bottom tab bar
 * should stand down — an open message thread, for instance, where the composer
 * sits at the bottom and five tabs underneath it read as clutter.
 *
 * A page reports this rather than the shell guessing from the URL: a thread is
 * `/messages?client=…`, a query param, and reading that in the shell would mean
 * useSearchParams — which opts the whole app into a client-side bailout. This
 * is the same shape as hasBack above.
 */
export function usePageImmersive(): boolean {
  return useContext(Ctx)?.immersive ?? false
}

/**
 * True while an immersive page has asked to KEEP the phone's top bar.
 *
 * Immersive answers "should the bottom tabs and the global + stand down?".
 * It does NOT answer "does this page bring its own header?", and conflating
 * the two cost a real bug: the product form turned immersive, the shell hid
 * its whole phone bar (written for a message thread, which does bring its own
 * header) and the form was left with no title, no back arrow and no way out
 * (Karl, 2026-08-06: "the header should always be there").
 *
 * So a page says which it is. Focused work that has no header of its own —
 * a form — passes keepTopBar and gets a bar stripped back to back + name.
 */
export function usePageImmersiveKeepsTopBar(): boolean {
  return useContext(Ctx)?.immersiveKeepsTopBar ?? false
}

/**
 * Hides the phone's bottom tab bar (and the global "+") while mounted.
 *
 * `keepTopBar` keeps the shell's phone header, minus its navigation — pass it
 * unless this page renders a header of its own, or there will be two.
 */
export function SetPageImmersive({ value, keepTopBar = false }: { value: boolean; keepTopBar?: boolean }) {
  const setImmersive = useContext(Ctx)?.setImmersive
  useEffect(() => {
    setImmersive?.(value, keepTopBar)
    return () => setImmersive?.(false, false)
  }, [value, keepTopBar, setImmersive])
  return null
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

/**
 * What this trainer calls their own menu items, so a PAGE can use their word too.
 *
 * Renaming "Library" to "Resources" in the menu and then landing on a page headed
 * "Library" reads as a bug, so PageHeader resolves its title through this. Empty
 * when nobody has renamed anything (and for the client app, which has no such
 * setting), which is the overwhelmingly common case.
 */
const NavLabelCtx = createContext<Record<string, string>>({})

export function NavLabelProvider({
  labels,
  children,
}: {
  labels: Record<string, string>
  children: ReactNode
}) {
  return <NavLabelCtx.Provider value={labels}>{children}</NavLabelCtx.Provider>
}

export function useNavLabelOverrides(): Record<string, string> {
  return useContext(NavLabelCtx)
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
