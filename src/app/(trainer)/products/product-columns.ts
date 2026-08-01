'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'

/**
 * Which columns the products table shows, remembered per browser.
 *
 * Product and Price are not in here — a row with neither is not a row. These
 * are the ones a trainer can turn on and off, and the order they are listed in
 * is the order they appear in the table.
 *
 * Status is off by default: for most trainers every product is simply live, so
 * the column is a wall of "Live" that costs room the product name wants.
 */
export const OPTIONAL_COLUMNS = [
  { key: 'category', label: 'Category' },
  { key: 'type', label: 'Type' },
  { key: 'stock', label: 'Stock' },
  { key: 'status', label: 'Status' },
] as const

export type ColumnKey = (typeof OPTIONAL_COLUMNS)[number]['key']

const KEY = 'pm.products.columns'
const DEFAULTS: ColumnKey[] = ['category', 'type', 'stock']

const KEYS = new Set<string>(OPTIONAL_COLUMNS.map(c => c.key))
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  // Another tab changing the columns should change this one too.
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

// A STRING, not a parsed array. useSyncExternalStore compares snapshots by
// identity, so returning a fresh Set here would re-render forever; the parsing
// happens once, in a memo, downstream.
function read(): string {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw == null ? DEFAULTS.join(',') : raw
  } catch {
    return DEFAULTS.join(',')
  }
}

const server = () => DEFAULTS.join(',')

export function useProductColumns(): [Set<ColumnKey>, (key: ColumnKey, on: boolean) => void] {
  // Both callbacks have to be stable or the store resubscribes every render.
  const sub = useCallback((cb: () => void) => subscribe(cb), [])
  const raw = useSyncExternalStore(sub, read, server)

  const chosen = useMemo(
    () => new Set(raw.split(',').filter((k): k is ColumnKey => KEYS.has(k))),
    [raw],
  )

  const toggle = useCallback((key: ColumnKey, on: boolean) => {
    const next = OPTIONAL_COLUMNS
      .map(c => c.key)
      .filter(k => (k === key ? on : chosen.has(k)))
    try { window.localStorage.setItem(KEY, next.join(',')) } catch { /* private mode */ }
    listeners.forEach(l => l())
  }, [chosen])

  return [chosen, toggle]
}
