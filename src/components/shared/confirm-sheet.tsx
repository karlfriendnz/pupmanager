'use client'

import { useEffect, type ReactNode } from 'react'
import { ModalPortal } from '@/components/shared/modal-portal'

/**
 * A yes/no in the same shell as ActionSheet — same portal, same body scroll
 * lock, same Escape and click-out.
 *
 * It exists because a destructive choice deserves a full sentence, which a menu
 * row has no room for, and because window.confirm is the one dialog a phone
 * renders worst.
 */
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <ModalPortal>
      <ConfirmShell onCancel={onCancel}>
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={title}
          className="relative w-full rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:max-w-sm sm:rounded-2xl"
          style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="mt-1.5 text-sm text-slate-600">{body}</p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
                danger
                  ? 'border-red-200 text-red-600 hover:bg-red-50'
                  : 'border-slate-200 text-slate-800 hover:bg-slate-50'
              }`}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </ConfirmShell>
    </ModalPortal>
  )
}

function ConfirmShell({ children, onCancel }: { children: ReactNode; onCancel: () => void }) {
  // Body scroll stays locked while this is up, so there's never a second rail;
  // Escape and a tap on the backdrop both back out.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onCancel} aria-hidden />
      {children}
    </div>
  )
}
