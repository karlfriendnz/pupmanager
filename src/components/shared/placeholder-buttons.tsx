'use client'

// One quiet row of "drop this in" buttons, shared by every screen where a
// trainer writes a message that gets personalised at send time.
//
// The button READS as words ("Dog name"); what it INSERTS is the raw token —
// see `lib/placeholder-labels.ts` for why the tokens themselves can never be
// renamed. Nothing here changes what is stored.

import type { PlaceholderOption } from '@/lib/placeholder-labels'

export function PlaceholderButtons({
  options,
  onInsert,
  hint = 'Tap to drop one in — it fills in when the message is sent.',
  className = '',
}: {
  options: readonly PlaceholderOption[]
  onInsert: (token: string) => void
  hint?: string
  className?: string
}) {
  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1.5">
        {options.map(p => (
          <button
            key={p.token}
            type="button"
            // Keep the caret where it is: the field must not blur before the
            // click handler reads its selection.
            onMouseDown={e => e.preventDefault()}
            onClick={() => onInsert(p.token)}
            className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            title={`Insert ${p.token}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

/**
 * Splice a token into a plain `<input>` / `<textarea>` at the caret and return
 * the new value (the caller owns the state). Falls back to appending when the
 * element has no selection — e.g. it was never focused.
 */
export function insertTokenAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  current: string,
  token: string,
): string {
  if (!el) return current + token
  const start = el.selectionStart ?? current.length
  const end = el.selectionEnd ?? current.length
  const next = current.slice(0, start) + token + current.slice(end)
  requestAnimationFrame(() => {
    el.focus()
    const pos = start + token.length
    el.setSelectionRange(pos, pos)
  })
  return next
}
