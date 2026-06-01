import { Play, ChevronLeft } from 'lucide-react'
import { BottomNav } from './bottom-nav'

// ─── Phone frame ───────────────────────────────────────────────────────────
export function PhoneFrame({ label, blurb, nav = true, children }: { label: string; blurb: string; nav?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 shrink-0">
      <div className="text-center">
        <p className="font-display text-base font-bold text-slate-800">{label}</p>
        <p className="text-xs text-slate-500 max-w-[340px]">{blurb}</p>
      </div>
      <div className="w-[380px] h-[800px] rounded-[2.75rem] bg-slate-900 p-2.5">
        <div className="relative w-full h-full rounded-[2.25rem] overflow-hidden bg-surface">
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 h-6 w-32 bg-slate-900 rounded-full z-[60]" />
          <div className="w-full h-full overflow-y-auto no-scrollbar">
            <div className={nav ? 'pb-24' : 'pb-8'}>{children}</div>
          </div>
          {nav && <BottomNav />}
        </div>
      </div>
    </div>
  )
}

// ─── Sticky top bar for sub-pages (back + title + optional action) ───────────
export function TopBar({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-20 bg-surface/85 backdrop-blur px-3 pt-12 pb-3 flex items-center gap-2">
      <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm text-slate-600 shrink-0"><ChevronLeft className="h-5 w-5" /></button>
      <h1 className="font-display text-xl font-bold text-slate-900 flex-1 truncate">{title}</h1>
      {action}
    </div>
  )
}

// ─── Section title ───────────────────────────────────────────────────────────
export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-2.5">
      <h2 className="font-display text-lg font-bold text-slate-900">{children}</h2>
      {action}
    </div>
  )
}

// Shared soft-card shadow used across all the screens.
export const CARD = 'rounded-3xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)]'

// ─── Desktop browser-window frame ───────────────────────────────────────────
export function BrowserFrame({ url = 'app.pupmanager.com/home', children }: { url?: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[1200px] rounded-2xl overflow-hidden border border-slate-200 bg-white">
      <div className="h-11 bg-slate-100 border-b border-slate-200 flex items-center px-4 gap-2">
        <span className="h-3 w-3 rounded-full bg-red-400" />
        <span className="h-3 w-3 rounded-full bg-amber-400" />
        <span className="h-3 w-3 rounded-full bg-green-400" />
        <div className="flex-1 flex justify-center">
          <div className="h-6 w-80 rounded-full bg-white border border-slate-200 flex items-center justify-center text-xs text-slate-400">{url}</div>
        </div>
      </div>
      <div className="h-[760px] overflow-hidden">{children}</div>
    </div>
  )
}

// ─── Circular progress ring ──────────────────────────────────────────────────
export function Ring({ done, total, size = 60, label }: { done: number; total: number; size?: number; label?: string }) {
  const stroke = 6
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = total > 0 ? done / total : 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-slate-200" />
        <circle
          cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeLinecap="round"
          className="fill-none stroke-accent" strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-display font-bold text-slate-900 text-sm">{done}/{total}</span>
        {label && <span className="text-[9px] text-slate-400 mt-0.5">{label}</span>}
      </div>
    </div>
  )
}

// ─── Stat tile ───────────────────────────────────────────────────────────────
export function StatTile({ value, label, icon, tone = 'plain' }: { value: string; label: string; icon: string; tone?: 'plain' | 'accent' }) {
  return (
    <div className={[
      'flex-1 rounded-2xl px-3 py-2.5 text-center',
      tone === 'accent' ? 'bg-accent text-white' : 'bg-white shadow-[0_2px_14px_rgba(15,31,36,0.06)]',
    ].join(' ')}>
      <div className="text-lg leading-none">{icon}</div>
      <div className={['font-display font-bold text-lg mt-1 leading-none', tone === 'accent' ? 'text-white' : 'text-slate-900'].join(' ')}>{value}</div>
      <div className={['text-[10px] mt-1 leading-tight', tone === 'accent' ? 'text-white/80' : 'text-slate-400'].join(' ')}>{label}</div>
    </div>
  )
}

// ─── Media gallery hero (trainer-curated photos/videos of the dog) ───────────
export function GalleryHero({
  items, heightClass = 'h-72', overlay, imgClass = 'object-cover',
}: {
  items: { id: string; src: string; video: boolean }[]
  heightClass?: string
  overlay?: React.ReactNode
  imgClass?: string
}) {
  return (
    <div className={`relative w-full ${heightClass} overflow-hidden bg-accent-soft`}>
      <div className="flex h-full w-full overflow-x-auto snap-x snap-mandatory no-scrollbar">
        {items.map(m => (
          <div key={m.id} className="relative h-full w-full shrink-0 snap-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.src} alt="" className={`h-full w-full ${imgClass}`} />
            {m.video && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/85 backdrop-blur shadow-lg">
                  <Play className="h-6 w-6 text-slate-900 ml-0.5" fill="currentColor" />
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      {/* dots */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-20">
        {items.map((m, i) => (
          <span key={m.id} className={['h-1.5 rounded-full transition-all', i === 0 ? 'w-5 bg-white' : 'w-1.5 bg-white/55'].join(' ')} />
        ))}
      </div>
      {overlay}
    </div>
  )
}

// ─── Segmented progress dots ●●●○○ ───────────────────────────────────────────
export function SegBar({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={['h-2 w-2 rounded-full', i < done ? 'bg-accent' : 'bg-slate-200'].join(' ')} />
      ))}
    </div>
  )
}
