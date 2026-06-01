'use client'

import { useState, useRef } from 'react'
import {
  Home, Calendar, GraduationCap, MessageSquare, Menu,
  ShoppingBag, Trophy, Dog, User, LogOut, ChevronRight, Globe, Phone, Info, Mail,
} from 'lucide-react'
import { MOCK } from './mock'

// Primary tabs + a "Menu" hamburger that opens a sheet with everything else
// a client can do. Replaces the old Profile tab.
const TABS = [
  { label: 'Home', icon: Home },
  { label: 'Sessions', icon: Calendar },
  { label: 'Classes', icon: GraduationCap },
  { label: 'Messages', icon: MessageSquare, badge: 1 },
]

// Everything a client can do, surfaced from the menu.
const MENU = [
  { label: 'Sessions', icon: Calendar },
  { label: 'Classes', icon: GraduationCap },
  { label: 'Messages', icon: MessageSquare },
  { label: 'Shop', icon: ShoppingBag },
  { label: 'Achievements', icon: Trophy },
  { label: 'My dogs', icon: Dog },
  { label: 'My details', icon: User },
]

export function BottomNav() {
  const [open, setOpen] = useState(false)
  // Translucent fills derived from the trainer's font colour, so chips and
  // dividers read correctly on any brand background / font colour combo.
  const chip = 'color-mix(in srgb, var(--accent-fg) 16%, transparent)'
  const divider = 'color-mix(in srgb, var(--accent-fg) 15%, transparent)'

  // Pull-down-to-dismiss for the full-screen menu. Drag the handle down past a
  // threshold to close; a plain tap on the handle closes too.
  const [dragY, setDragY] = useState(0)
  const dragStart = useRef<number | null>(null)
  const moved = useRef(false)
  const onDragDown = (e: React.PointerEvent) => { dragStart.current = e.clientY; moved.current = false; e.currentTarget.setPointerCapture(e.pointerId) }
  const onDragMove = (e: React.PointerEvent) => { if (dragStart.current == null) return; const dy = e.clientY - dragStart.current; if (dy > 5) moved.current = true; setDragY(dy > 0 ? dy : 0) }
  const onDragUp = () => { const past = dragY > 110; dragStart.current = null; setDragY(0); if (past) setOpen(false) }

  return (
    <>
      {/* Full-screen menu — background = trainer brand colour, text = trainer
          font colour (both derive everything else via color-mix on --accent-fg) */}
      {open && (
        <div
          className="absolute inset-0 z-40 flex flex-col animate-pm-fade"
          style={{
            backgroundColor: 'var(--accent)',
            color: 'var(--accent-fg)',
            transform: `translateY(${dragY}px)`,
            opacity: 1 - Math.min(dragY / 700, 0.35),
            transition: dragStart.current == null ? 'transform 240ms cubic-bezier(0.16,1,0.3,1), opacity 240ms' : 'none',
          }}
        >
          {/* Pull-down handle — drag down (or tap) to dismiss */}
          <div
            onPointerDown={onDragDown} onPointerMove={onDragMove} onPointerUp={onDragUp}
            onClick={() => { if (!moved.current) setOpen(false) }}
            className="pt-9 pb-2 flex justify-center cursor-grab active:cursor-grabbing"
            style={{ touchAction: 'none' }}
          >
            <span className="h-1.5 w-12 rounded-full" style={{ backgroundColor: chip }} />
          </div>

          {/* Header — trainer logo + contact (logoUrl in the real app) */}
          <div className="px-5 pt-1 pb-6 text-center">
            <div className="flex items-center justify-center gap-2">
              <span className="text-2xl" aria-hidden>🐾</span>
              <span className="font-display text-2xl font-extrabold leading-none">{MOCK.business}</span>
            </div>
            <div className="mt-4 flex items-center justify-center gap-3">
              {[
                { icon: Globe, href: `https://${MOCK.website}`, label: 'Website' },
                { icon: Phone, href: `tel:${MOCK.phone.replace(/\s/g, '')}`, label: 'Call' },
                { icon: Info, href: '#about', label: 'About' },
                { icon: Mail, href: 'mailto:hello@demodogtraining.co.nz', label: 'Email' },
              ].map(c => (
                <a key={c.label} href={c.href} target="_blank" rel="noreferrer" title={c.label} aria-label={c.label}
                  className="flex h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: chip }}>
                  <c.icon className="h-5 w-5" />
                </a>
              ))}
            </div>
          </div>

          {/* Body — full-width list, icon on the left */}
          <div className="flex-1 overflow-y-auto no-scrollbar px-3 pb-10">
            <div className="rounded-2xl overflow-hidden">
              {MENU.map((item, i) => (
                <button key={item.label} className="w-full flex items-center gap-4 px-3 py-3.5 text-left" style={i > 0 ? { borderTop: `1px solid ${divider}` } : undefined}>
                  <span className="flex h-9 w-9 items-center justify-center shrink-0"><item.icon className="h-5 w-5" /></span>
                  <span className="text-[15px] font-semibold flex-1">{item.label}</span>
                  <ChevronRight className="h-4 w-4 shrink-0" style={{ opacity: 0.5 }} />
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-2xl overflow-hidden" style={{ borderTop: `1px solid ${divider}` }}>
              <button className="w-full flex items-center gap-4 px-3 py-3.5 text-left">
                <span className="flex h-9 w-9 items-center justify-center shrink-0"><LogOut className="h-5 w-5" /></span>
                <span className="text-[15px] font-medium flex-1">Sign out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab bar — hidden while the full-screen menu is open (pull down to close) */}
      {!open && (
        <div className="absolute bottom-0 inset-x-0 z-50 bg-white/95 backdrop-blur border-t border-slate-100 px-2 pt-2 pb-6">
          <div className="flex justify-around">
            {TABS.map(item => {
              const active = item.label === 'Home'
              return (
                <button key={item.label} className={['flex flex-col items-center gap-1 px-2', active ? 'text-accent' : 'text-slate-400'].join(' ')}>
                  <span className="relative">
                    <item.icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 2} />
                    {item.badge ? <span className="absolute -top-1 -right-1.5 h-3.5 min-w-3.5 px-1 rounded-full bg-rose-500 text-white text-[8px] font-bold flex items-center justify-center">{item.badge}</span> : null}
                  </span>
                  <span className="text-[10px] font-medium">{item.label}</span>
                </button>
              )
            })}
            <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-1 px-2 text-slate-400">
              <Menu className="h-[22px] w-[22px]" strokeWidth={2} />
              <span className="text-[10px] font-medium">Menu</span>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
