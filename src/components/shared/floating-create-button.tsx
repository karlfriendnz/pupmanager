'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Receipt, UserPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SaleComposer } from './sale-composer'

// The mobile "+" — new client / new sale.
//
// The desktop control bar is `hidden md:flex`, so its "+" is invisible on a
// phone: exactly the device a trainer has in hand when they'd ring up a sale.
// This is the phone answer. It floats above the bottom nav on the dashboard
// only, rather than following every page, so it never sits on top of a page's
// own primary action.
export function FloatingCreateButton({
  canSell = false,
  currency = 'nzd',
}: {
  canSell?: boolean
  currency?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saleOpen, setSaleOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <>
      {/* Sits above the bottom bar (h-16) plus the safe-area inset, so it
          clears the nav and the home indicator on a notched phone. */}
      <div
        ref={ref}
        className="md:hidden fixed right-4 z-40 flex flex-col items-end gap-2"
        style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px) + 1rem)' }}
      >
        {open && (
          <div className="flex flex-col items-end gap-2 animate-pm-fade">
            {canSell && (
              <FabAction icon={<Receipt className="h-4 w-4" />} label="New sale" onClick={() => { setOpen(false); setSaleOpen(true) }} />
            )}
            <FabAction icon={<UserPlus className="h-4 w-4" />} label="New client" onClick={() => { setOpen(false); router.push('/clients?new=1') }} />
          </div>
        )}

        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Create"
          aria-expanded={open}
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full bg-[var(--pm-brand-600)] text-white shadow-lg transition-transform active:scale-95',
            open && 'rotate-45',
          )}
        >
          <Plus className="h-6 w-6" />
        </button>
      </div>

      <SaleComposer open={saleOpen} onClose={() => setSaleOpen(false)} currency={currency} />
    </>
  )
}

function FabAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-full bg-white py-2.5 pl-4 pr-5 text-sm font-medium text-slate-700 shadow-lg active:bg-slate-50"
    >
      <span className="text-slate-400">{icon}</span>
      {label}
    </button>
  )
}
