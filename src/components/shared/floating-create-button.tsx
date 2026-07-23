'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Plus, Receipt, UserPlus, Package, Zap } from 'lucide-react'
import { SaleComposer } from './sale-composer'

// The mobile "+" — the phone counterpart to the desktop control bar's "+".
//
// Lives in the mobile top bar (TrainerMobileHeader), NOT as a floating dashboard
// button, so it's reachable from every page just like the desktop one. Offers
// the SAME choices (New offering / Quick client / Full client / New sale) so the
// two bars stay in step. Opening it lays a blurred scrim over the page so the
// choices stand out.
export function FloatingCreateButton({
  canSell = false,
  currency = 'nzd',
}: {
  canSell?: boolean
  currency?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
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

  // New offering pre-picks the kind when you're on a specific offering page,
  // matching the desktop "+".
  const newOffering = () => {
    setOpen(false)
    const href = pathname.startsWith('/classes') ? '/packages/new?kind=group'
      : pathname.startsWith('/drop-ins') ? '/packages/new?kind=dropin'
      : pathname.startsWith('/events') ? '/packages/new?kind=oneoff'
      : '/packages/new'
    router.push(href)
  }

  return (
    <>
      {/* Blurred scrim behind the open menu, so the choices stand out from the
          page content. Taps close the menu. */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm animate-pm-fade"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <div ref={ref} className="relative z-50 shrink-0">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Create"
          aria-haspopup="menu"
          aria-expanded={open}
          className="grid h-9 w-9 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <Plus className="h-[18px] w-[18px]" />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-xl animate-pm-fade"
          >
            <MenuItem icon={<Package className="h-4 w-4 text-slate-400" />} label="New offering" onClick={newOffering} />
            <div className="my-1 border-t border-slate-100" />
            <MenuItem icon={<Zap className="h-4 w-4 text-slate-400" />} label="Quick client" onClick={() => { setOpen(false); router.push('/clients?new=1') }} />
            <MenuItem icon={<UserPlus className="h-4 w-4 text-slate-400" />} label="Full client" onClick={() => { setOpen(false); router.push('/clients/invite') }} />
            {canSell && (
              <MenuItem icon={<Receipt className="h-4 w-4 text-slate-400" />} label="New sale" onClick={() => { setOpen(false); setSaleOpen(true) }} />
            )}
          </div>
        )}
      </div>

      <SaleComposer open={saleOpen} onClose={() => setSaleOpen(false)} currency={currency} />
    </>
  )
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
    >
      {icon}
      {label}
    </button>
  )
}
