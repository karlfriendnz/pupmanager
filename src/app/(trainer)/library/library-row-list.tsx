'use client'

import { useState } from 'react'

import { FlatBlock, FlatRow } from '@/components/shared/flat-list'
import { SortableOfferingCard, SortableOfferingList } from '@/components/shared/offering-card'

/**
 * A list of Library rows you can drag into order — the themes inside a category
 * and the items inside a theme, which are the same screen twice.
 *
 * Both orders are read back by getLibraryTree, so dragging here sets the
 * navigation tree and the drill-down on a phone as well as this list. It saves
 * optimistically and puts the list back if the save fails: an order that only
 * exists in React state is a screen that rearranges itself on the next load.
 */

export interface LibraryRow {
  id: string
  label: string
  sub?: string
  href: string
}

export function LibraryRowList({
  rows: incoming,
  endpoint,
  noun,
}: {
  rows: LibraryRow[]
  /** Where the new order is POSTed as `{ ids }`. */
  endpoint: string
  /** What one row is, for the failure message — "theme", "item". */
  noun: string
}) {
  const [rows, setRows] = useState(incoming)
  const [error, setError] = useState<string | null>(null)

  // Adjust state when the server sends a different list — adding a row refreshes
  // the page, and state seeded once from props would ignore the new one.
  // Order-sensitive on purpose: after a drag the server comes back agreeing with
  // us, so this is a no-op; if the save didn't land, the server's order wins.
  const signature = incoming.map(r => r.id).join(',')
  const [synced, setSynced] = useState(signature)
  if (signature !== synced) {
    setSynced(signature)
    setRows(incoming)
  }

  function reorder(ids: string[]) {
    const before = rows
    setRows(ids.map(id => before.find(r => r.id === id)!).filter(Boolean))
    setSynced(ids.join(','))
    setError(null)
    void (async () => {
      const revert = () => {
        setRows(before)
        setSynced(before.map(r => r.id).join(','))
        setError(`Could not save that ${noun} order.`)
      }
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        })
        if (!res.ok) revert()
      } catch {
        revert()
      }
    })()
  }

  return (
    <>
      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      <SortableOfferingList ids={rows.map(r => r.id)} onReorder={reorder}>
        <FlatBlock>
          {rows.map(r => (
            <SortableOfferingCard key={r.id} id={r.id}>
              {handle => <FlatRow label={r.label} sub={r.sub} href={r.href} dragHandle={handle} />}
            </SortableOfferingCard>
          ))}
        </FlatBlock>
      </SortableOfferingList>
    </>
  )
}
