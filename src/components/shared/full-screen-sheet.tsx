'use client'

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { ModalPortal } from '@/components/shared/modal-portal'

/**
 * The house overlay for anything too big to be a menu: a picker, a search, a
 * list of choices.
 *
 * PHONE — the whole screen, with its own title bar and a close button.
 * A 56px menu hanging off a corner is not a phone UI (AGENTS.md: full screens,
 * not dropdowns), and five options deserve room to explain themselves.
 *
 * DESKTOP — a centred panel over a dimmed page. The same overlay blown up to
 * 1440px was an entire grey screen holding five short rows, which loses where
 * you were and reads as a page you navigated to rather than a choice you are
 * making. Same content, contained.
 *
 * Body scroll is locked while it is open, and its own scrolling region carries
 * `no-scrollbar`, so there is never a second scrollbar on screen — Karl's
 * standing rule. Portaled to <body> because these open from headers that use
 * `backdrop-blur`, and a filtered ancestor becomes the containing block for a
 * `position: fixed` child.
 */
/**
 * How wide the centred panel gets on desktop. Not a second layout: the phone is
 * the whole screen either way, and the panel's insides are laid out the same at
 * both widths. A picker of one-line rows reads badly stretched, and a form with
 * paired fields reads badly squeezed — this is the container being responsive,
 * which is the only place AGENTS.md allows the difference to live.
 */
const PANEL_WIDTH = {
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
} as const

export function FullScreenSheet({
  title,
  sub,
  onClose,
  headerExtra,
  footer,
  size = 'md',
  children,
}: {
  title: string
  sub?: string
  onClose: () => void
  /** Pinned under the title bar, OUTSIDE the scroll region — e.g. a search field. */
  headerExtra?: ReactNode
  /** Pinned to the bottom, outside the scroll region — e.g. the confirm button. */
  footer?: ReactNode
  /** Desktop panel width. `lg` for a form; the default suits a list of choices. */
  size?: keyof typeof PANEL_WIDTH
  children: ReactNode
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[90] sm:flex sm:items-center sm:justify-center sm:p-4">
        {/* A backdrop only where the panel doesn't already fill the screen —
            on a phone there is nothing behind it to dim or to click past. */}
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={onClose}
          className="absolute inset-0 hidden cursor-default bg-slate-900/40 sm:block"
        />
        <div
          role="dialog"
          aria-modal="true"
          // The sub is part of the NAME, not decoration: "Add homework" alone
          // does not say which session, and a screen reader (or a test) landing
          // on the dialog gets only its label.
          aria-label={sub ? `${title} — ${sub}` : title}
          className={`relative flex h-full w-full flex-col bg-slate-50 sm:h-auto sm:max-h-[85vh] sm:overflow-hidden sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-xl ${PANEL_WIDTH[size]}`}
        >
          <div className="flex flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 pt-[env(safe-area-inset-top)] sm:pt-0">
            <div className="min-w-0 flex-1 py-3.5">
              <p className="truncate text-[15px] font-semibold text-slate-900">{title}</p>
              {sub && <p className="mt-0.5 truncate text-[13px] text-slate-500">{sub}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 flex-shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:text-slate-700"
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>

          {headerExtra}

          <div className="no-scrollbar flex-1 overflow-y-auto p-4">{children}</div>

          {footer && (
            // The phone's safe area is the panel's problem only when the panel
            // IS the screen; inside a centred modal there is nothing below it.
            <div
              className="flex-shrink-0 border-t border-slate-200 bg-white px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] sm:pb-3"
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}
