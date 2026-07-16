import {
  Home as HomeIcon,
  CalendarDays,
  GraduationCap,
  MessageSquare,
  Menu as MenuIcon,
  ShoppingBag,
  CalendarPlus,
} from 'lucide-react'

import { DEFAULT_BRAND_COLOR } from '@/lib/brand'

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
// A friendly sample pup so the preview reads as the real, photo-forward client
// home rather than an empty mockup. Local asset → no external load to fail.
const SAMPLE_DOG = '/sample-dog.jpg'

// Phone mockup of the client app, used to live-preview a trainer's branding
// (logo + brand colour). Mirrors the real (client)/home screen: a dog-photo
// hero with the business name overlaid, floating quick-actions, an "Up next"
// card in the solid brand colour, and the client tab bar. Shared by the
// first-run personalization wizard and Settings → Design so the preview matches
// both.
export function BrandPreview({
  businessName,
  logoUrl,
  iconUrl,
  brandColor,
  note,
}: {
  businessName: string
  logoUrl: string
  // Square brand mark. Preferred for the small square avatar; falls back to the
  // logo, then the business initial.
  iconUrl?: string
  brandColor: string
  note: string
}) {
  const name = businessName.trim() || 'Your business'
  const accent = HEX.test(brandColor) ? brandColor : DEFAULT_BRAND_COLOR
  const soft = `color-mix(in srgb, ${accent} 12%, white)`

  return (
    <div className="relative rounded-[2.6rem] border-[9px] border-slate-900 bg-slate-900 shadow-2xl mx-auto w-[228px] h-[464px] ring-1 ring-black/20">
      {/* notch */}
      <div aria-hidden className="absolute top-0 left-1/2 -translate-x-1/2 z-20 h-5 w-24 rounded-b-2xl bg-slate-900" />
      {/* screen — stays off-white; brand colour only on accents */}
      <div className="h-full w-full rounded-[1.9rem] overflow-hidden bg-slate-50 flex flex-col">

        {/* ── Dog-photo hero ── */}
        <div className="relative h-[170px] flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SAMPLE_DOG} alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_28%]" />
          {/* legibility scrims */}
          <div aria-hidden className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/45 to-transparent" />
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/60 to-transparent" />

          {/* status bar */}
          <div className="relative flex items-center justify-between text-[10px] font-semibold text-white/90 px-4 pt-2.5">
            <span>9:41</span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-3 rounded-[1px] bg-white/70" />
              <span className="h-2 w-2.5 rounded-full bg-white/70" />
              <span className="h-2 w-4 rounded-[2px] border border-white/70" />
            </span>
          </div>

          {/* logo + business name */}
          <div className="relative flex items-center gap-2 px-4 mt-2">
            <div
              className={`h-8 w-8 rounded-xl overflow-hidden flex items-center justify-center text-xs font-bold text-white flex-shrink-0${iconUrl ? '' : ' ring-1 ring-white/50'}`}
              style={iconUrl ? undefined : { background: accent }}
            >
              {iconUrl
                // Uploaded icon: render clean (often transparent) — no coloured box.
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={iconUrl} alt="" className="h-full w-full object-contain" />
                : logoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={logoUrl} alt="" className="h-full w-full object-contain bg-white/90 p-0.5" />
                : name[0]?.toUpperCase()}
            </div>
            <span className="text-xs font-semibold text-white drop-shadow truncate">{name}</span>
          </div>

          {/* dog name overlay */}
          <div className="absolute bottom-2.5 left-4 right-4">
            <p className="text-lg font-bold text-white leading-tight drop-shadow-sm">Bailey</p>
            <p className="text-[10px] text-white/85 drop-shadow-sm">Golden Retriever · 1 yr</p>
          </div>
        </div>

        {/* ── Floating quick actions ── */}
        <div className="px-3 -mt-6 relative z-10">
          <div className="rounded-2xl bg-white shadow-md ring-1 ring-black/5 p-1.5 flex">
            {[{ icon: CalendarPlus, label: 'Book' }, { icon: MessageSquare, label: 'Message' }, { icon: ShoppingBag, label: 'Shop' }].map((a, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 py-1">
                <span className="h-7 w-7 rounded-xl grid place-items-center" style={{ backgroundColor: soft, color: accent }}>
                  <a.icon className="h-3.5 w-3.5" />
                </span>
                <span className="text-[8.5px] font-medium text-slate-500">{a.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-hidden px-3 pt-2.5 pb-2 space-y-2">
          <p className="text-[11px] text-slate-400 px-1">Hi Sarah 👋</p>

          {note.trim() && (
            <div className="rounded-2xl p-2.5" style={{ backgroundColor: soft }}>
              <p className="text-[8.5px] font-semibold uppercase tracking-wide" style={{ color: accent }}>Welcome</p>
              <p className="text-[10px] text-slate-600 mt-0.5 line-clamp-2">{note.trim()}</p>
            </div>
          )}

          {/* up next — solid brand colour */}
          <div className="rounded-2xl p-3 text-white shadow-sm" style={{ background: accent }}>
            <p className="text-[8.5px] font-semibold uppercase tracking-wide text-white/80">Up next · in 3 days</p>
            <p className="text-[12px] font-bold mt-0.5 leading-tight">Loose-lead walking</p>
            <p className="text-[9.5px] text-white/85 mt-0.5">Sat 10:00am · 60 min</p>
          </div>
        </div>

        {/* ── Client tab bar ── */}
        <div className="border-t border-slate-100 bg-white px-4 pt-1.5 pb-1 flex items-center justify-between">
          {[HomeIcon, CalendarDays, GraduationCap, MessageSquare, MenuIcon].map((Icon, i) => (
            <Icon key={i} className="h-[17px] w-[17px]" style={{ color: i === 0 ? accent : '#cbd5e1' }} />
          ))}
        </div>
        {/* home indicator */}
        <div className="bg-white flex justify-center pb-1.5"><span className="h-1 w-20 rounded-full bg-slate-300" /></div>
      </div>
    </div>
  )
}
