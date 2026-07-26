'use client'

import { Layers } from 'lucide-react'

/**
 * The first thing a trainer who has never opened the Library sees.
 *
 * It explains what a category IS and what to do next, rather than rendering an
 * empty grid — this screen has to teach the shape of the thing (category →
 * theme → item) before any of the rest makes sense.
 *
 * Client-side only so the icon is imported here; see library-category-grid.tsx.
 */
export function LibraryEmpty() {
  return (
    <div className="px-4 py-10 text-center">
      <Layers className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.75} />
      <p className="mt-3 text-sm font-medium text-slate-900">Your library is empty</p>
      <p className="mx-auto mt-1 max-w-sm text-[13px] text-slate-500">
        Categories are the broad strokes — &ldquo;Obedience&rdquo;, &ldquo;Agility&rdquo;.
        Inside each one you group themes, and inside those go the exercises you
        hand out most. Start with one category; you can rename it later.
      </p>
    </div>
  )
}
