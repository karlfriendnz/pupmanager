'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { ModalPortal } from '@/components/shared/modal-portal'

// The overflow menu ("More") for a toolbar or a card heading. Shared: the
// invoice document opened the first one, the offering detail screens opened the
// second, and a second copy of a scroll-locking portal is a second copy of
// every bug it ever had.
//
// House style: a 56px menu hanging off a corner is not a phone UI, so this
// opens as a full-width sheet off the bottom edge on a phone with room to
// label every option, and settles into a small centred panel once there's
// desktop width. Portaled to <body> via ModalPortal — the mobile header uses
// `backdrop-blur`, and a filtered ancestor becomes the containing block for
// `position: fixed`.
//
// It locks body scroll for as long as it's open and its own scroll region
// carries `no-scrollbar`, so there is never a second scrollbar on screen.
export interface SheetAction {
  key: string
  label: string
  hint?: string
  icon: ReactNode
  onSelect: () => void
  disabled?: boolean
  /** Destructive — red, and separated from what came before it. */
  danger?: boolean
}

export function ActionSheet({
  title,
  actions,
  onClose,
}: {
  title: string
  actions: SheetAction[]
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    // Land the caret on the first option so the sheet is reachable by keyboard
    // straight after it opens.
    panelRef.current?.querySelector<HTMLButtonElement>('button[data-sheet-action]')?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4 print:hidden">
        <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:max-w-sm sm:rounded-2xl"
        >
          <div className="flex min-h-[3.5rem] flex-shrink-0 items-center gap-2 border-b border-slate-100 px-4">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{title}</p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>
          <div className="no-scrollbar flex-1 divide-y divide-slate-100 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            {actions.map(a => (
              <button
                key={a.key}
                data-sheet-action=""
                type="button"
                disabled={a.disabled}
                onClick={a.onSelect}
                // A destructive option gets the red and a thicker rule above it,
                // so it can't be picked by momentum on the way down the list.
                className={`flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 active:bg-slate-50 disabled:opacity-50 ${
                  a.danger ? 'border-t-4 border-t-slate-100 hover:bg-red-50 active:bg-red-50' : ''
                }`}
              >
                <span className={`shrink-0 ${a.danger ? 'text-red-600' : 'text-slate-700'}`}>{a.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium ${a.danger ? 'text-red-600' : 'text-slate-900'}`}>{a.label}</span>
                  {a.hint && <span className="block text-xs text-slate-400">{a.hint}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
