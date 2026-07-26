'use client'

import { useId } from 'react'
import { DndContext, type DndContextProps } from '@dnd-kit/core'

/**
 * The ONLY way this app opens a dnd-kit drag context. Use it instead of
 * `<DndContext>` anywhere a sortable list is server-rendered.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `@dnd-kit/utilities` generates its element ids from a MODULE-SCOPED counter:
 *
 *     let ids = {}
 *     function useUniqueId(prefix, value) {
 *       return useMemo(() => {
 *         if (value) return value                       // ← our escape hatch
 *         const id = ids[prefix] == null ? 0 : ids[prefix] + 1
 *         ids[prefix] = id
 *         return `${prefix}-${id}`
 *       }, [prefix, value])
 *     }
 *
 * `DndContext` calls `useUniqueId('DndDescribedBy', id)` and puts the result on
 * every drag handle as `aria-describedby`, so it lands in the SSR HTML.
 *
 * That counter is per MODULE INSTANCE, and the two runtimes do not share one.
 * In the Node server the module is loaded once and lives for the whole process,
 * so the counter climbs with every DndContext the server has ever rendered,
 * across every request, and never resets. In the browser it starts again at 0
 * on each fresh document. The server therefore ships
 * `aria-describedby="DndDescribedBy-137"` and hydration renders
 * `aria-describedby="DndDescribedBy-0"` — a mismatch React reports as
 * "A tree hydrated but some attributes of the server rendered HTML didn't match
 * the client properties. This won't be patched up." It is not a race and not a
 * caching artefact: it reproduces on the second load of any offering list, and
 * the number in it is just how long the server has been up. (Which is also why
 * a long-running dev server produces ids in the hundreds.)
 *
 * The fix is the `value` branch above: pass an explicit `id` and dnd-kit hands
 * it straight back without touching the counter. `useId()` is React's own
 * hydration-stable identifier — the same tree position yields the same string
 * on the server and on the client — so this works for a page with several drag
 * contexts, and for a component rendered many times, with no naming to keep
 * unique by hand.
 *
 * An explicit `id` prop still wins if a caller passes one; everything else is
 * forwarded untouched.
 *
 * `DndLiveRegion-N` comes off the same counter but never reaches the SSR HTML —
 * dnd-kit's `<Accessibility>` returns null until it has mounted — and the
 * `Draggable-N` / `Droppable-N` keys are internal registration handles that are
 * never rendered. `DndDescribedBy` is the only one that can break hydration.
 */
export function DndArea({ id, children, ...rest }: DndContextProps) {
  const generatedId = useId()
  return (
    <DndContext id={id ?? generatedId} {...rest}>
      {children}
    </DndContext>
  )
}
