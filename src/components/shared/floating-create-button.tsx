'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Plus, Receipt, UserPlus, Package, Zap, X, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SaleComposer } from './sale-composer'
import { ModalPortal } from './modal-portal'
import { prePickedOfferingHref } from '@/lib/offering-create'
import { usePageImmersive } from './page-title'

// The mobile "+" — the phone counterpart to the desktop control bar's "+".
//
// It is MOUNTED in the mobile top bar (TrainerMobileHeader) but it no longer
// DRAWS there: the trigger is portaled out to a circle pinned above the bottom
// tab bar, on the right. The top-right corner of a phone is the furthest point
// on the screen from a thumb holding it, and it is where the one control a
// trainer reaches for all day was sitting. The bottom right is where the thumb
// already rests.
//
// It replaces rather than joins. There is no + in the header any more and no
// add button in a list's own top row on a phone (see OfferingListBar) — three
// ways to create the same thing is what made that row unusable at 390px.
// Offers the SAME choices as the desktop "+" (New offering / Quick client /
// Full client / New sale), so the two never drift.
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

  // The circle belongs to the HOME screen and nowhere else (Karl, 2026-08-06:
  // "the plus circle should only be on the home page", sent from an achievement
  // edit screen where it was floating over the colour picker). It floats in the
  // bottom-right corner of every screen it is on, so on any screen with work in
  // it — a form, a colour picker, a list you are reordering — it is a button
  // over someone else's content offering to start something unrelated.
  //
  // Home is where you go to start things; everywhere else the page's own
  // create action, and the desktop bar's "+", already cover it. That also
  // retires two special cases this used to carry (the offering wizard's
  // Cancel/Next bar, an open message thread) — neither is home.
  //
  // Phone only either way: the desktop control bar has its own "+", which is
  // NOT affected by this and still starts anything from anywhere.
  const immersive = usePageImmersive()
  const hideOnPhone = immersive || pathname !== '/dashboard'

  // A screen that is HIDDEN is a screen that is closed.
  //
  // This component does not unmount when you navigate — the shell keeps it
  // mounted and it simply renders nothing off the home screen. So an open
  // create screen that gets hidden by a navigation stayed "open" forever: the
  // lock below never re-ran its cleanup, and `document.body.overflow` was left
  // at `hidden` on EVERY page afterwards. A page that will not scroll, with
  // nothing on screen to say why (Karl, on /settings?tab=configure).
  //
  // The lock is therefore keyed on whether the screen is actually SHOWING, not
  // on a flag that can outlive it, and the flag is cleared to match.
  const showingScreen = open && !hideOnPhone

  // Syncing state to something OUTSIDE React (the route this component is
  // mounted across) is what this escape hatch is for: without it, leaving the
  // dashboard with the screen open and coming back later re-opens it, mid-way
  // through whatever you came back to do.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (hideOnPhone) { setOpen(false); setSaleOpen(false) }
  }, [hideOnPhone])

  useEffect(() => {
    if (!showingScreen) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [showingScreen])

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
  // matching the desktop "+". The rule lives in one place because the list bar
  // reads it too — see prePickedOfferingHref.
  const newOfferingHref = prePickedOfferingHref(pathname) ?? '/offerings/new'

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
          hint: '1:1 session, group class, casual class or event',
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
          hint: 'Charge a client for a product or 1:1 session',
          run: () => { setOpen(false); setSaleOpen(true) },
        },
      ],
    }] : []),
  ]

  return (
    <>
      {/* Portaled to <body> for the same reason the screen below is: the mobile
          header this is mounted in uses backdrop-blur, and a filtered ancestor
          becomes the containing block for anything fixed inside it — the circle
          would be pinned to the bottom of a 56px bar rather than the screen.

          Sits 4.5rem up, which clears the 58px tab bar with 14px to spare, plus
          whatever the home indicator claims. z-30 is deliberately BELOW the tab
          bar (z-40) and every sheet and modal (z-70), so an open full screen
          covers it rather than floating a create button over a form.

          md:hidden because the portal escapes the header that was hiding it —
          on a desktop the "+" in the control bar is the one that exists. */}
      {!hideOnPhone && (
      <ModalPortal>
        {/* The room the circle needs under the last row, declared BY the circle
            — so it appears and disappears with it rather than being a constant
            gap on the two screens that have no circle.

            The shell reserves 5rem plus the home-indicator inset for the tab
            bar, which was the whole story while the "+" lived in the header.
            The circle's top edge now reaches 8rem up, and the bottom half of
            the last card in every list was underneath it. !important because
            the value it beats is a Tailwind arbitrary utility of equal
            specificity, where the winner would otherwise be decided by the
            order the stylesheet happened to be built in. */}
        <style>{`@media (max-width: 767px) { .pm-main { padding-bottom: calc(9rem + env(safe-area-inset-bottom, 0px)) !important; } }`}</style>
        <button
          onClick={() => setOpen(true)}
          aria-label="Create"
          aria-haspopup="dialog"
          aria-expanded={open}
          className="md:hidden fixed right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-[var(--pm-brand-600)] text-white shadow-[0_6px_16px_rgba(15,31,36,0.18)] transition-colors active:bg-[var(--pm-brand-700)]"
          style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <Plus className="h-6 w-6" strokeWidth={2.25} />
        </button>
      </ModalPortal>
      )}

      {/* Portaled to <body>: this button lives in the mobile header, which uses
          backdrop-blur — and a filtered ancestor becomes the containing block
          for fixed descendants, so inset-0 would size to the 56px bar. */}
      {/* showingScreen, not `open`: this sits OUTSIDE the block above, so an
          open screen left behind by a navigation would otherwise still be
          painted over whatever page you landed on. */}
      {showingScreen && (
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
