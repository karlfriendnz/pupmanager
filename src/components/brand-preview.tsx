import {
  CalendarDays,
  Home as HomeIcon,
  MessageCircle as MessageCircleIcon,
  Menu as MenuIcon,
} from 'lucide-react'

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const DEFAULT_GRADIENT_START = '#2a9da9'
const DEFAULT_GRADIENT_END = '#1f818c'

// Phone mockup of the client app, used to live-preview a trainer's branding
// (logo + accent gradient). Shared by the first-run personalization wizard and
// Settings → Design so the preview is identical in both places.
export function BrandPreview({
  businessName,
  logoUrl,
  gradStart,
  gradEnd,
  note,
}: {
  businessName: string
  logoUrl: string
  gradStart: string
  gradEnd: string
  note: string
}) {
  const name = businessName.trim() || 'Your business'
  const gradient = `linear-gradient(135deg, ${HEX.test(gradStart) ? gradStart : DEFAULT_GRADIENT_START}, ${HEX.test(gradEnd) ? gradEnd : DEFAULT_GRADIENT_END})`
  const accent = HEX.test(gradStart) ? gradStart : DEFAULT_GRADIENT_START
  return (
    <div className="relative rounded-[2.6rem] border-[9px] border-slate-900 bg-slate-900 shadow-2xl mx-auto w-[228px] h-[464px] ring-1 ring-black/20">
      {/* notch */}
      <div aria-hidden className="absolute top-0 left-1/2 -translate-x-1/2 z-20 h-5 w-24 rounded-b-2xl bg-slate-900" />
      {/* screen — stays off-white regardless of brand colour; brand only on accents */}
      <div className="h-full w-full rounded-[1.9rem] overflow-hidden bg-slate-50 flex flex-col">
        {/* header */}
        <div className="px-4 pt-2.5 pb-3">
          {/* status bar */}
          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 px-1">
            <span>9:41</span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-3 rounded-[1px] bg-slate-300" />
              <span className="h-2 w-2.5 rounded-full bg-slate-300" />
              <span className="h-2 w-4 rounded-[2px] border border-slate-300" />
            </span>
          </div>
          <div className="flex items-center gap-2.5 mt-3.5">
            <div className="h-9 w-9 rounded-xl overflow-hidden flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{ backgroundImage: gradient }}>
              {logoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={logoUrl} alt="" className="h-full w-full object-contain p-1" />
                : name[0]?.toUpperCase()}
            </div>
            <span className="text-sm font-semibold text-slate-800 truncate">{name}</span>
          </div>
          <p className="text-xs text-slate-400 mt-3">Hi Sarah 👋</p>
          <p className="text-lg font-bold text-slate-900 leading-tight">Bailey’s training</p>
        </div>

        {/* body */}
        <div className="flex-1 overflow-hidden px-3 pb-3 space-y-2.5">
          {note.trim() && (
            <div className="rounded-2xl bg-white shadow-sm p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Welcome</p>
              <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-3">{note.trim()}</p>
            </div>
          )}
          <div className="rounded-2xl bg-white shadow-sm p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Up next</p>
            <div className="flex items-center gap-2 mt-1">
              <div className="h-7 w-7 rounded-lg flex items-center justify-center text-white" style={{ backgroundImage: gradient }}>
                <CalendarDays className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-slate-800 truncate">Loose-lead walking</p>
                <p className="text-[10px] text-slate-400">In 3 days · 60 min</p>
              </div>
            </div>
          </div>
          <button className="w-full rounded-xl py-2 text-[11px] font-semibold text-white" style={{ backgroundImage: gradient }}>Book a session</button>
        </div>

        {/* bottom tab bar */}
        <div className="border-t border-slate-100 bg-white px-5 pt-2 pb-1.5 flex items-center justify-between">
          {[{ icon: HomeIcon, on: true }, { icon: CalendarDays, on: false }, { icon: MessageCircleIcon, on: false }, { icon: MenuIcon, on: false }].map((t, i) => (
            <t.icon key={i} className="h-[18px] w-[18px]" style={{ color: t.on ? accent : '#cbd5e1' }} />
          ))}
        </div>
        {/* home indicator */}
        <div className="bg-white flex justify-center pb-1.5"><span className="h-1 w-20 rounded-full bg-slate-300" /></div>
      </div>
    </div>
  )
}
