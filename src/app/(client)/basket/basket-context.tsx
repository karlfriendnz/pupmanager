'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  addBasketLine, basketCount, basketLineKey, basketSubtotalCents,
  removeBasketLine, setBasketQuantity, type BasketLine,
} from '@/lib/basket'

/**
 * The basket, held in the client's own browser.
 *
 * ONE PROVIDER, MOUNTED IN THE CLIENT LAYOUT, so the count follows them from
 * the shop to the booking screen and back — a basket that emptied itself when
 * they went to look at the classes would be worse than no basket.
 *
 * SCOPED TO THE ACTIVE CLIENT PROFILE, not the user. One dog owner can work
 * with several trainers (each their own ClientProfile), and a basket is paid to
 * exactly one trainer's Stripe account — carrying a harness from one business
 * into another's checkout is not a bug we want to have to explain.
 *
 * localStorage IS the basket, read through useSyncExternalStore rather than
 * copied into state by an effect — the same pattern as the products table's
 * column choices. That gets three things for free: no hydration mismatch (the
 * server snapshot is an empty basket), a second tab that adds something shows
 * up here, and there is exactly one copy of the truth to go stale.
 *
 * localStorage rather than sessionStorage because paying leaves the app
 * entirely (Stripe's hosted page, and on the native shells the system browser),
 * so the basket has to survive the round trip in order to be cleared correctly
 * on the way back — see the `basketPaid` effect below.
 */

interface BasketApi {
  lines: BasketLine[]
  count: number
  subtotalCents: number
  add: (line: BasketLine) => void
  remove: (key: string) => void
  setQuantity: (key: string, quantity: number) => void
  clear: () => void
  /** Is this line already in the basket? Lets a shop button say "In basket". */
  has: (line: BasketLine) => boolean
  isOpen: boolean
  open: () => void
  close: () => void
  /** Name of the thing just added, for the brief "Added" confirmation. */
  justAdded: string | null
}

const Ctx = createContext<BasketApi | null>(null)

const STORAGE_PREFIX = 'pm.basket.v1.'
const EMPTY = '[]'

const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  // Another tab of the same app adding something should show up here too.
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

// The RAW JSON, not a parsed array. useSyncExternalStore compares snapshots by
// identity, so returning a fresh array here would re-render forever; the parse
// happens once, in a memo, downstream.
function readRaw(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? EMPTY
  } catch {
    // Private mode, quota, storage disabled — an empty basket is a fine
    // outcome; refusing to render the app is not.
    return EMPTY
  }
}

function writeRaw(key: string, raw: string) {
  try {
    if (raw === EMPTY) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, raw)
  } catch { /* storage blocked — nothing to do but carry on */ }
  listeners.forEach(l => l())
}

function parse(raw: string): BasketLine[] {
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? (value as BasketLine[]) : []
  } catch {
    return []
  }
}

export function BasketProvider({
  clientProfileId,
  children,
}: {
  clientProfileId: string
  children: React.ReactNode
}) {
  const storageKey = `${STORAGE_PREFIX}${clientProfileId}`
  const [isOpen, setIsOpen] = useState(false)
  const [justAdded, setJustAdded] = useState<string | null>(null)

  // Both callbacks must be stable or the store resubscribes every render.
  const sub = useCallback((cb: () => void) => subscribe(cb), [])
  const read = useCallback(() => readRaw(storageKey), [storageKey])
  const raw = useSyncExternalStore(sub, read, () => EMPTY)
  const lines = useMemo(() => parse(raw), [raw])

  const write = useCallback(
    (next: BasketLine[]) => writeRaw(storageKey, next.length === 0 ? EMPTY : JSON.stringify(next)),
    [storageKey],
  )

  // Coming back from a paid checkout. The success URL carries `basketPaid=1`
  // and it is handled HERE rather than on a page, because the return lands on
  // whichever screen suits what was bought (/my-sessions for a class,
  // /my-shop for a shop-only basket) and both must empty the basket. A
  // CANCELLED checkout deliberately keeps it — they came back to change
  // something, not to lose the lot.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('basketPaid') !== '1') return
    writeRaw(storageKey, EMPTY)
    url.searchParams.delete('basketPaid')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  }, [storageKey])

  useEffect(() => {
    if (!justAdded) return
    const t = window.setTimeout(() => setJustAdded(null), 2600)
    return () => window.clearTimeout(t)
  }, [justAdded])

  const add = useCallback((line: BasketLine) => {
    write(addBasketLine(parse(readRaw(storageKey)), line))
    setJustAdded(line.name)
  }, [storageKey, write])

  const remove = useCallback(
    (key: string) => write(removeBasketLine(parse(readRaw(storageKey)), key)),
    [storageKey, write],
  )
  const setQuantity = useCallback(
    (key: string, quantity: number) => write(setBasketQuantity(parse(readRaw(storageKey)), key, quantity)),
    [storageKey, write],
  )
  const clear = useCallback(() => write([]), [write])
  const has = useCallback(
    (line: BasketLine) => {
      const key = basketLineKey(line)
      return lines.some(l => basketLineKey(l) === key)
    },
    [lines],
  )

  const value = useMemo<BasketApi>(() => ({
    lines,
    count: basketCount(lines),
    subtotalCents: basketSubtotalCents(lines),
    add, remove, setQuantity, clear, has,
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    justAdded,
  }), [lines, add, remove, setQuantity, clear, has, isOpen, justAdded])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * The basket, or null when there isn't one.
 *
 * Nullable on purpose: the shop grid and the booking wizard are also rendered
 * in places outside the client layout (a trainer preview harness, a test), and
 * a hook that throws would turn "no basket here" into a blank screen.
 */
export function useBasketOptional(): BasketApi | null {
  return useContext(Ctx)
}

/** For components that are only ever mounted inside the client app. */
export function useBasket(): BasketApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('useBasket must be used inside <BasketProvider>')
  return api
}
