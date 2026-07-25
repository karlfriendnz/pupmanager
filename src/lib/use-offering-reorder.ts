'use client'

import { useCallback, useState } from 'react'

export type ReorderKind = 'package' | 'classRun' | 'membership'

/**
 * Drag-to-reorder for an offering list. Applies the new order immediately and
 * saves in the background — a reorder that waited on the network would fight
 * the drag. If the save fails the list snaps back to the server's order and
 * says so, rather than showing an order that isn't real.
 *
 * `rows` is whatever the list renders; each needs an `id`.
 */
export function useOfferingReorder<T extends { id: string }>(initial: T[], kind: ReorderKind) {
  const [rows, setRows] = useState(initial)
  const [error, setError] = useState<string | null>(null)

  const reorder = useCallback((orderedIds: string[]) => {
    setRows(prev => {
      const before = prev
      const byId = new Map(prev.map(r => [r.id, r]))
      // Only the dragged subset is passed (a tab shows one slice of the list),
      // so splice those back into their own positions and leave the rest put.
      const dragged = new Set(orderedIds)
      let next = 0
      const after = prev.map(r => (dragged.has(r.id) ? byId.get(orderedIds[next++])! : r))

      setError(null)
      fetch('/api/trainer/offerings/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ids: after.map(r => r.id) }),
      })
        .then(res => {
          if (!res.ok) {
            setRows(before)
            setError('Couldn’t save that order — put back as it was.')
          }
        })
        .catch(() => {
          setRows(before)
          setError('Couldn’t reach the server — order put back as it was.')
        })

      return after
    })
  }, [kind])

  return { rows, setRows, reorder, error }
}
