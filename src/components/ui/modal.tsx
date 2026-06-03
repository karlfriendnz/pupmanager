'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

// Lightweight centered modal: dimmed backdrop, click-out / Esc to close,
// scroll lock while open. Render conditionally (`{open && <Modal …>}`) or
// pass `open`.
export function Modal({
  open = true,
  onClose,
  title,
  children,
}: {
  open?: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-slate-400 hover:text-slate-700"
        >
          <X className="h-5 w-5" />
        </button>
        {title && <h2 className="mb-4 pr-6 text-lg font-semibold text-slate-900">{title}</h2>}
        {children}
      </div>
    </div>
  )
}
