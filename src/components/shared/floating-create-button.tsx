'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Plus, Receipt, UserPlus, Package, Zap, X, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SaleComposer } from './sale-composer'
import { ModalPortal } from './modal-portal'

// The mobile "+" — the phone counterpart to the desktop control bar's "+".
//
// Lives in the mobile top bar (TrainerMobileHeader), NOT as a floating dashboard
// button, so it's reachable from every page just like the desktop one. Offers
// the SAME choices (New offering / Quick client / Full client / New sale) so the
// two bars stay in step.
//
// On a phone those choices open as a full screen rather than a dropdown: a
// 56px-wide menu hanging off the corner is a poor target and gives no room to
// say what each choice actually does.
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

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  // The home grid's "Instant sale" tile opens this composer — it's mounted
  // here, so it asks by event rather than mounting a second one.
  useEffect(() => {
    const open = () => setSaleOpen(true)
    window.addEventListener('pm:open-sale', open)
    return () => window.removeEventListener('pm:open-sale', open)
  }, [])

  // No close-on-navigation effect needed: every choice closes the screen before
  // it routes, and Escape / the X cover the rest.

  // New offering pre-picks the kind when you're on a specific offering page,
  // matching the desktop "+".
  const newOfferingHref = pathname.startsWith('/classes') ? '/offerings/new?kind=group'
    : pathname.startsWith('/casual-classes') ? '/offerings/new?kind=dropin'
    : pathname.startsWith('/events') ? '/offerings/new?kind=oneoff'
    : '/offerings/new'

  type Choice = { icon: LucideIcon; label: string; hint: string; run: () => void }
  const groups: { heading: string; choices: Choice[] }[] = [
    {
      heading: 'Clients',
      choices: [
        {
          icon: Zap,
          label: 'Quick client',
          hint: 'Just a name and dog — fill in the rest later',
          run: () => router.push('/clients?new=1'),
        },
        {
          icon: UserPlus,
          label: 'Full client',
          hint: 'Every detail, and send them an invite',
          run: () => router.push('/clients/invite'),
        },
      ],
    },
    {
      heading: 'Offerings',
      choices: [
        {
          icon: Package,
          label: 'New offering',
          hint: '1:1 consult, group class, casual class or event',
          run: () => router.push(newOfferingHref),
        },
      ],
    },
    ...(canSell ? [{
      heading: 'Money',
      choices: [
        {
          icon: Receipt,
          label: 'New sale',
          hint: 'Charge a client for a product or consult',
          run: () => { setOpen(false); setSaleOpen(true) },
        },
      ],
    }] : []),
  ]

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Create"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 transition-colors active:bg-slate-100"
      >
        <Plus className="h-[20px] w-[20px]" />
      </button>

      {/* Portaled to <body>: this button lives in the mobile header, which uses
          backdrop-blur — and a filtered ancestor becomes the containing block
          for fixed descendants, so inset-0 would size to the 56px bar. */}
      {open && (
        <ModalPortal>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create"
          className="md:hidden fixed inset-0 z-[70] flex flex-col bg-white animate-pm-fade"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-100 px-3">
            <h2 className="min-w-0 flex-1 pl-1 text-base font-semibold text-slate-900">
              What would you like to add?
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500 active:bg-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div
            className="flex-1 overflow-y-auto p-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
          >
            {groups.map(group => (
              <div key={group.heading} className="mb-5 last:mb-0">
                <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                  {group.heading}
                </p>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
                  {group.choices.map(choice => {
                    const Icon = choice.icon
                    return (
                      <button
                        key={choice.label}
                        type="button"
                        onClick={() => { setOpen(false); choice.run() }}
                        className="flex w-full items-center gap-3.5 px-4 py-4 text-left active:bg-slate-50"
                      >
                        <Icon className="h-[22px] w-[22px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold leading-tight text-slate-900">
                            {choice.label}
                          </span>
                          <span className="mt-0.5 block text-[13px] leading-tight text-slate-500">
                            {choice.hint}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        </ModalPortal>
      )}

      <SaleComposer open={saleOpen} onClose={() => setSaleOpen(false)} currency={currency} />
    </>
  )
}
